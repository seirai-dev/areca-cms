import { z } from 'zod'

import { isSafeIdentifier } from '#/lib/content-identifiers'
import {
  FIELD_LABEL_MAX_LENGTH,
  ID_MAX_LENGTH,
  MAX_FIELDS_PER_COLLECTION,
} from '#/lib/content-limits'
import { GLOBAL_PREVIEW_PATH_MAX_LENGTH } from '#/lib/globals'
import { SEO_KEY } from '#/lib/seo'
import type { EntryData } from '#/lib/types'
import { loadSiteLanguages } from '#/server/content/locale-validation'
import {
  assertSectionSeo,
  deleteGlobal,
  discardGlobalDraft,
  getGlobalEntry,
  upsertGlobal,
} from '#/server/content/globals'
import { updateDraft } from '#/server/content/entries'
import { pickDeclaredFields } from '#/server/content/validation'
import { ValidationError } from '#/server/content/errors'

import {
  describeGlobal,
  mergeSeo,
  seoPatchFromInput,
  toStoredFields,
} from '../entry-format'
import { McpNotFoundError } from '../errors'
import type { McpActor } from '../keys'
import { applyLocaleWrite, resolveLocale, withSharedNote } from '../locales'
import {
  assertSiteImages,
  assetLookupFor,
  expectedVersion,
  formatStoredEntry,
  localeInput,
  withImportWarnings,
} from './entries'
import { loadGlobalInSite } from '../scope'
import { fieldsInputSchema, seoInputSchema } from '../schemas'
import type { ToolRegistry } from '../tool-kit'
import { fieldSchema, requiredLanguagesInput } from './schema'

/**
 * Site content (globals): single sections such as company info or the home
 * page. Each section has one entry, so these tools address it by key and
 * return its entry id for the workflow tools (mark_ready, schedule_entry, ...).
 */

const globalKey = z
  .string()
  .min(1)
  .max(ID_MAX_LENGTH)
  .describe('Site content key from get_site_info, e.g. "companyInfo".')

/** The section and its entry, after the visibility check in loadGlobalInSite. */
async function loadSection(actor: McpActor, key: string) {
  await loadGlobalInSite(actor, key)
  const found = await getGlobalEntry(actor.siteId, key)
  if (!found) {
    throw new McpNotFoundError(
      `No site content "${key}" on this site. Call get_site_info to see the valid keys.`,
    )
  }
  return found
}

export function registerGlobalTools(registry: ToolRegistry): void {
  registry.add({
    name: 'get_global',
    title: 'Get site content',
    description:
      'Returns one site content section (a single set of values, such as company info or the home page): id, key, label, status (draft, ready or scheduled), live (on the production site now), pendingRelease (approved changes waiting for the next go live), version, editedSinceReady, fields (the format of each field), example, values (rich text as Markdown, images as {assetId,url,alt}, references as {entryId}), seo (only when the section has SEO), and previewAvailable. On a site with languages, locale returns that language\'s values; without it you get the main language plus translations, the completeness of each other language. Use the returned id with mark_ready, schedule_entry, cancel_schedule, list_revisions, restore_revision and get_preview_url. Read-only.',
    inputSchema: z.object({ global: globalKey, locale: localeInput }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: async (input, actor) => {
      const section = await loadSection(actor, input.global)
      const languages = await loadSiteLanguages(actor.siteId)
      const target = resolveLocale(languages, input.locale)
      return {
        ...(await formatStoredEntry(actor, section.entry.id, {
          locale: target?.locale,
          translations: input.locale === undefined,
        })),
        ...describeGlobal(section.global.fields, section.global.seoEnabled, languages),
      }
    },
  })

  registry.add({
    name: 'update_global',
    title: 'Update site content',
    description:
      'Changes the draft of one site content section. Only the fields and seo keys you send change; others stay as they are. Clear a field by sending an empty string or null; clear an seo key with an empty string (text), false (boolean) or an empty array (list). seo is refused when the section has no SEO (get_global says whether it does). Pass expectedVersion from get_global to avoid overwriting newer changes. The live site does not change until the section is marked ready again and the next go live happens. Returns the saved section.',
    inputSchema: z.object({
      global: globalKey,
      fields: fieldsInputSchema.optional(),
      seo: seoInputSchema.optional(),
      locale: localeInput,
      expectedVersion,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      if (input.fields === undefined && input.seo === undefined) {
        throw new ValidationError([
          { path: '', message: 'Nothing to update. Pass fields and/or seo' },
        ])
      }
      const { global, entry } = await loadSection(actor, input.global)
      const languages = await loadSiteLanguages(actor.siteId)
      const target = resolveLocale(languages, input.locale)
      if (input.seo !== undefined) {
        assertSectionSeo(global, { [SEO_KEY]: input.seo })
      }
      const inputs = input.fields ?? {}
      const patch = seoPatchFromInput(input.seo)
      const assets = await assetLookupFor(actor, global.fields, inputs, patch)
      const converted = toStoredFields(global.fields, inputs, assets)
      assertSiteImages(global.fields, converted, assets)
      let data: EntryData
      let shared: string[] = []
      if (languages && target) {
        const written = applyLocaleWrite({
          fields: global.fields,
          languages,
          locale: target.locale,
          stored: entry.draftData,
          converted,
          seo: patch,
          seoEnabled: global.seoEnabled,
        })
        data = written.data
        shared = written.sharedFieldsUpdated
      } else {
        data = pickDeclaredFields(global.fields, entry.draftData)
        if (!global.seoEnabled) delete data[SEO_KEY]
        Object.assign(data, converted)
        const seo = mergeSeo(
          (data[SEO_KEY] as Record<string, unknown> | undefined) ?? undefined,
          patch,
        )
        if (seo) data[SEO_KEY] = seo
        else delete data[SEO_KEY]
      }
      const updated = await updateDraft(
        entry.id,
        data,
        actor.userId,
        input.expectedVersion ?? entry.draftVersion,
      )
      return withSharedNote(
        withImportWarnings(
          await formatStoredEntry(actor, entry.id, {
            withPreview: true,
            locale: target?.locale,
            translations: true,
          }),
          updated.importWarnings,
        ),
        target,
        shared,
      )
    },
  })

  registry.add({
    name: 'discard_global_draft',
    title: 'Discard site content draft',
    description:
      'Throws away the draft of one site content section and goes back to its ready version (the scheduled version while one is scheduled). Refused when the section has never been marked ready. The discard is kept in the history. Returns the section.',
    inputSchema: z.object({ global: globalKey }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    run: async (input, actor) => {
      const section = await loadSection(actor, input.global)
      await discardGlobalDraft(actor.siteId, section.global.key, actor.userId)
      return formatStoredEntry(actor, section.entry.id)
    },
  })

  registry.add({
    name: 'upsert_global',
    title: 'Create or update site content',
    description:
      'Agency admin only. Creates a site content section, or replaces its label, fields, SEO setting, preview path and enabled flag if the key exists. Fields replace the whole list, so send every field. A section cannot have a slug field. Set group on a field to show a heading above it in the editor. previewPath is a path on the site such as "/about" (the section is previewed there); send an empty string to remove it. Keeps the section\'s content when redefined.',
    inputSchema: z.object({
      key: z
        .string()
        .refine(
          isSafeIdentifier,
          'Use letters, numbers and underscores, starting with a letter',
        )
        .describe('Section key, e.g. "companyInfo". Used in tool calls.'),
      label: z
        .string()
        .trim()
        .min(1)
        .max(FIELD_LABEL_MAX_LENGTH)
        .describe('Human name, e.g. "Company info".'),
      fields: z.array(fieldSchema).max(MAX_FIELDS_PER_COLLECTION),
      seo: z
        .boolean()
        .optional()
        .describe('true gives the section an SEO panel (title, description, ...). Default false.'),
      previewPath: z
        .string()
        .max(GLOBAL_PREVIEW_PATH_MAX_LENGTH)
        .optional()
        .describe('Page on the site that shows this section, e.g. "/about". Empty string removes it.'),
      enabled: z
        .boolean()
        .optional()
        .describe('false hides the section from editing. Default true.'),
      requiredLanguages: requiredLanguagesInput,
    }),
    access: 'agency',
    deniedMessage:
      'Only agency admins can change site content structure. Ask an agency admin, or change the values with update_global.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      const row = await upsertGlobal(
        actor.siteId,
        {
          key: input.key,
          label: input.label,
          fields: input.fields,
          seo: input.seo,
          previewPath: input.previewPath,
          enabled: input.enabled,
          requiredLanguages: input.requiredLanguages,
        },
        actor.userId,
      )
      const languages = await loadSiteLanguages(actor.siteId)
      return {
        key: row.key,
        label: row.label,
        enabled: row.enabled,
        seo: row.seoEnabled,
        previewPath: row.previewPath,
        fieldKeys: row.fields.map((field) => field.key),
        ...(languages
          ? { requiredLanguages: row.requiredLanguages }
          : {}),
      }
    },
  })

  registry.add({
    name: 'delete_global',
    title: 'Delete site content',
    description:
      'Agency admin only, destructive. Deletes a site content section from the site. Its content is kept in the deleted-content archive. Only do this when the user has clearly asked for it; disabling the section (upsert_global with enabled false) hides it and keeps everything.',
    inputSchema: z.object({
      key: z.string().min(1).max(ID_MAX_LENGTH).describe('Section key to delete.'),
    }),
    access: 'agency',
    deniedMessage:
      'Only agency admins can delete site content. Ask an agency admin.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    run: async (input, actor) => {
      await deleteGlobal(actor.siteId, input.key, actor.userId)
      return { deleted: true, key: input.key }
    },
  })
}
