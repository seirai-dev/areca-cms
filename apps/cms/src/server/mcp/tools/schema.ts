import { z } from '#/lib/zod'

import { isSafeIdentifier } from '#/lib/content-identifiers'
import { GLOBAL_GROUP_MAX_LENGTH } from '#/lib/globals'
import {
  FIELD_DESCRIPTION_MAX_LENGTH,
  FIELD_LABEL_MAX_LENGTH,
  FIELD_MAX_OPTIONS,
  FIELD_OPTION_MAX_LENGTH,
  ID_MAX_LENGTH,
  LOCALE_TAG_MAX_LENGTH,
  MAX_FIELDS_PER_COLLECTION,
  MAX_SITE_LANGUAGES,
  ROUTE_PATTERN_MAX_LENGTH,
} from '#/lib/content-limits'
import type { FieldType } from '#/lib/types'
import {
  deleteCollection,
  upsertCollection,
} from '#/server/content/collections'
import { loadSiteLanguages } from '#/server/content/locale-validation'

import type { ToolRegistry } from '../tool-kit'
import { languageSummary } from './site'

const FIELD_TYPES = [
  'text',
  'textarea',
  'richtext',
  'image',
  'date',
  'datetime',
  'select',
  'reference',
  'slug',
  'boolean',
  'number',
  'url',
] as const satisfies readonly FieldType[]

/**
 * Same rules as the agency schema server function (server/fn/content.ts).
 * Shared with upsert_global, which also takes `group`; collections reject it
 * in the backend (validateContentDefinitions).
 */
export const fieldSchema = z.object({
  translatable: z
    .boolean()
    .optional()
    .describe(
      'Only on sites with languages: true stores the field per language, false shares it across languages. Text, textarea, richtext and url are per language by default; the others are shared.',
    ),
  key: z
    .string()
    .refine(
      isSafeIdentifier,
      'Use letters, numbers and underscores, starting with a letter',
    )
    .describe(
      'Field key, camelCase or snake_case, e.g. "heroImage". Used as the key in fields.',
    ),
  label: z
    .string()
    .trim()
    .min(1)
    .max(FIELD_LABEL_MAX_LENGTH)
    .describe('Label shown in the CMS editor.'),
  type: z
    .enum(FIELD_TYPES)
    .describe(
      'text, textarea, richtext (Markdown), image (asset), date (YYYY-MM-DD), datetime (ISO with offset), select (needs options), reference (needs collection), slug, boolean, number, url.',
    ),
  required: z
    .boolean()
    .optional()
    .describe('Must be filled before an owner can mark an entry ready.'),
  options: z
    .array(z.string().max(FIELD_OPTION_MAX_LENGTH))
    .max(FIELD_MAX_OPTIONS)
    .optional()
    .describe('Choices for a select field.'),
  collection: z
    .string()
    .max(FIELD_OPTION_MAX_LENGTH)
    .optional()
    .describe(
      'For reference fields: the key of the collection the value points into.',
    ),
  description: z
    .string()
    .max(FIELD_DESCRIPTION_MAX_LENGTH)
    .optional()
    .describe('Help text shown to editors.'),
  after: z
    .string()
    .min(1)
    .max(FIELD_OPTION_MAX_LENGTH)
    .optional()
    .describe(
      'For date or datetime fields: the key of another date field this must be on or after.',
    ),
  group: z
    .string()
    .min(1)
    .max(GLOBAL_GROUP_MAX_LENGTH)
    .optional()
    .describe(
      'Site content (upsert_global) only: a heading shown above this field in the editor. Collection fields must not set it.',
    ),
})

/** Languages that must be complete before an entry can be marked ready. */
export const requiredLanguagesInput = z
  .array(z.string().min(1).max(LOCALE_TAG_MAX_LENGTH))
  .max(MAX_SITE_LANGUAGES)
  .optional()
  .describe(
    'Languages besides the main one that must be complete before an entry is marked ready, e.g. ["en"]. Omit to keep the current list. Ignored on a site without languages.',
  )

/** Route patterns per language. Each one starts with "/" and holds $slug. */
const localizedRoutesInput = z
  .record(
    z.string().min(1).max(LOCALE_TAG_MAX_LENGTH),
    z
      .string()
      .min(1)
      .max(ROUTE_PATTERN_MAX_LENGTH)
      .refine(
        (pattern) => pattern.startsWith('/') && pattern.includes('$slug'),
        'A route starts with / and contains $slug, e.g. "/vacatures/$slug"',
      ),
  )
  .optional()
  .describe(
    'Route per language, e.g. {"nl": "/vacatures/$slug"}. Languages not listed use routePattern. Patterns do not contain the language prefix; the site adds it. Send {} to remove them all. Ignored on a site without languages.',
  )

const SCHEMA_WARNING =
  'Warning: if this site syncs its schema from code (an areca manifest push), the next push replaces collections changed here. Prefer changing areca.config.ts when the site has one.'

export function registerSchemaTools(registry: ToolRegistry): void {
  registry.add({
    name: 'upsert_collection',
    title: 'Create or update collection',
    description: `Agency admin only. Creates a collection, or replaces its label, route, fields and enabled flag if the key exists. Fields replace the whole list, so send every field. A slug field is added automatically if missing. ${SCHEMA_WARNING}`,
    inputSchema: z.object({
      key: z
        .string()
        .refine(
          isSafeIdentifier,
          'Use letters, numbers and underscores, starting with a letter',
        )
        .describe('Collection key, e.g. "posts". Used in tool calls.'),
      label: z
        .string()
        .trim()
        .min(1)
        .max(FIELD_LABEL_MAX_LENGTH)
        .describe('Human name, e.g. "Blog posts".'),
      routePattern: z
        .string()
        .min(1)
        .max(ROUTE_PATTERN_MAX_LENGTH)
        .describe(
          'Public route, e.g. "/blog/$slug". $slug is replaced by the entry slug.',
        ),
      fields: z.array(fieldSchema).max(MAX_FIELDS_PER_COLLECTION),
      enabled: z
        .boolean()
        .optional()
        .describe('false hides the collection from editing. Default true.'),
      requiredLanguages: requiredLanguagesInput,
      routes: localizedRoutesInput,
    }),
    access: 'agency',
    deniedMessage:
      'Only agency admins can change the collection schema. Ask an agency admin, or change the content instead.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      const row = await upsertCollection(
        actor.siteId,
        {
          key: input.key,
          label: input.label,
          routePattern: input.routePattern,
          fields: input.fields,
          enabled: input.enabled,
          requiredLanguages: input.requiredLanguages,
          localizedRoutes:
            input.routes === undefined
              ? undefined
              : Object.keys(input.routes).length > 0
                ? input.routes
                : null,
        },
        actor.userId,
      )
      const languages = await loadSiteLanguages(actor.siteId)
      return {
        key: row.key,
        label: row.label,
        route: row.routePattern,
        enabled: row.enabled,
        fieldKeys: row.fields.map((field) => field.key),
        ...(languages
          ? {
              languages: languageSummary(languages),
              requiredLanguages: row.requiredLanguages,
              routes: row.localizedRoutes,
            }
          : {}),
      }
    },
  })

  registry.add({
    name: 'delete_collection',
    title: 'Delete collection',
    description: `Agency admin only, destructive. Deletes a collection and its entries from the site. Only do this when the user has clearly asked for it. ${SCHEMA_WARNING}`,
    inputSchema: z.object({
      key: z
        .string()
        .min(1)
        .max(ID_MAX_LENGTH)
        .describe('Collection key to delete.'),
    }),
    access: 'agency',
    deniedMessage:
      'Only agency admins can delete collections. Ask an agency admin.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      await deleteCollection(actor.siteId, input.key, actor.userId)
      return { deleted: true, key: input.key }
    },
  })
}
