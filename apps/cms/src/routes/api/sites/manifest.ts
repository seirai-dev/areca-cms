import { isSafeIdentifier } from '#/lib/content-identifiers'
import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'
import { z } from 'zod'

import {
  GLOBAL_GROUP_MAX_LENGTH,
  GLOBAL_PREVIEW_PATH_MAX_LENGTH,
} from '#/lib/globals'
import {
  FIELD_DESCRIPTION_MAX_LENGTH,
  FIELD_LABEL_MAX_LENGTH,
  FIELD_MAX_OPTIONS,
  FIELD_OPTION_MAX_LENGTH,
  MANIFEST_MAX_BYTES,
  MANIFEST_MAX_COLLECTIONS,
  MAX_FIELDS_PER_COLLECTION,
  MAX_SITE_LANGUAGES,
  ROUTE_PATTERN_MAX_LENGTH,
} from '#/lib/content-limits'
import { localeTagSchema } from '#/lib/content-locale'
import type { FieldType, SiteManifest } from '#/lib/types'
import { listCollections, syncManifest } from '#/server/content/collections'
import { listGlobals } from '#/server/content/globals'
import { authenticateSite } from '#/server/content/site-auth'

const fieldTypes = [
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

const fieldSchema = z.strictObject({
  key: z.string().refine(isSafeIdentifier, 'Unsafe identifier'),
  label: z.string().min(1).max(FIELD_LABEL_MAX_LENGTH),
  type: z.enum(fieldTypes),
  required: z.boolean().optional(),
  options: z
    .array(z.string().max(FIELD_OPTION_MAX_LENGTH))
    .max(FIELD_MAX_OPTIONS)
    .optional(),
  collection: z.string().max(FIELD_OPTION_MAX_LENGTH).optional(),
  description: z.string().max(FIELD_DESCRIPTION_MAX_LENGTH).optional(),
  after: z.string().min(1).max(FIELD_OPTION_MAX_LENGTH).optional(),
  translatable: z.boolean().optional(),
})

/** Site content fields are collection fields plus an editor-only group heading. */
const globalFieldSchema = fieldSchema.extend({
  group: z.string().min(1).max(GLOBAL_GROUP_MAX_LENGTH).optional(),
})

const languagesSchema = z.strictObject({
  main: localeTagSchema,
  all: z.array(localeTagSchema).min(1).max(MAX_SITE_LANGUAGES),
})

const requiredLanguagesSchema = z.array(localeTagSchema).max(MAX_SITE_LANGUAGES)

const manifestSchema = z.strictObject({
  languages: languagesSchema.optional(),
  collections: z.record(
    z.string().refine(isSafeIdentifier, 'Unsafe identifier'),
    z.strictObject({
      route: z.string().min(1).max(ROUTE_PATTERN_MAX_LENGTH),
      label: z.string().max(FIELD_LABEL_MAX_LENGTH).optional(),
      fields: z.array(fieldSchema).max(MAX_FIELDS_PER_COLLECTION),
      routes: z
        .record(
          localeTagSchema,
          z.string().min(1).max(ROUTE_PATTERN_MAX_LENGTH),
        )
        .optional(),
      requiredLanguages: requiredLanguagesSchema.optional(),
    }),
  ),
  globals: z
    .record(
      z.string().refine(isSafeIdentifier, 'Unsafe identifier'),
      z.strictObject({
        label: z.string().max(FIELD_LABEL_MAX_LENGTH).optional(),
        fields: z.array(globalFieldSchema).max(MAX_FIELDS_PER_COLLECTION),
        seo: z.boolean().optional(),
        previewPath: z.string().max(GLOBAL_PREVIEW_PATH_MAX_LENGTH).optional(),
        requiredLanguages: requiredLanguagesSchema.optional(),
      }),
    )
    .optional(),
})

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE })
}

class BodyTooLargeError extends Error {}

/** Read the body without ever buffering more than `limit` bytes. */
async function readBoundedText(request: Request, limit: number) {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isFinite(length) || length < 0 || length > limit) {
      throw new BodyTooLargeError()
    }
  }
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLargeError()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function getSitesManifest(request: Request) {
  const site = await authenticateSite(request)
  if (!site) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const rows = await listCollections(site.id, { enabledOnly: true })
  const collections: SiteManifest['collections'] = {}
  for (const row of rows) {
    collections[row.key] = {
      route: row.routePattern,
      label: row.label,
      fields: row.fields,
      ...(row.localizedRoutes ? { routes: row.localizedRoutes } : {}),
      ...(row.requiredLanguages.length > 0
        ? { requiredLanguages: row.requiredLanguages }
        : {}),
    }
  }

  const sections = await listGlobals(site.id, { enabledOnly: true })
  const globals: NonNullable<SiteManifest['globals']> = {}
  for (const row of sections) {
    globals[row.key] = {
      label: row.label,
      fields: row.fields,
      seo: row.seoEnabled,
      ...(row.previewPath ? { previewPath: row.previewPath } : {}),
      ...(row.requiredLanguages.length > 0
        ? { requiredLanguages: row.requiredLanguages }
        : {}),
    }
  }

  return json({
    ...(site.languages ? { languages: site.languages } : {}),
    collections,
    // Omitted when there are no enabled sections.
    ...(Object.keys(globals).length > 0 ? { globals } : {}),
  } satisfies SiteManifest)
}

export async function postSitesManifest(request: Request) {
  const site = await authenticateSite(request, 'schema')
  if (!site) {
    return json({ error: 'Unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = JSON.parse(await readBoundedText(request, MANIFEST_MAX_BYTES))
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return json(
        { error: `Manifest is larger than ${MANIFEST_MAX_BYTES} bytes` },
        413,
      )
    }
    return json(
      { error: 'Invalid body', issues: [{ message: 'Expected JSON' }] },
      400,
    )
  }

  // Validate raw keys before object parsers can strip special prototype properties.
  if (
    body &&
    typeof body === 'object' &&
    'collections' in body &&
    body.collections &&
    typeof body.collections === 'object' &&
    Object.keys(body.collections).some((key) => !isSafeIdentifier(key))
  ) {
    return json({ error: 'Invalid collection identifier' }, 400)
  }
  if (
    body &&
    typeof body === 'object' &&
    'globals' in body &&
    body.globals &&
    typeof body.globals === 'object' &&
    Object.keys(body.globals).some((key) => !isSafeIdentifier(key))
  ) {
    return json({ error: 'Invalid site content identifier' }, 400)
  }
  if (
    body &&
    typeof body === 'object' &&
    'collections' in body &&
    body.collections &&
    typeof body.collections === 'object' &&
    Object.keys(body.collections).length > MANIFEST_MAX_COLLECTIONS
  ) {
    return json(
      {
        error: `A manifest can have at most ${MANIFEST_MAX_COLLECTIONS} collections`,
      },
      400,
    )
  }
  const parsed = manifestSchema.safeParse(body)
  if (!parsed.success) {
    return json({ error: 'Invalid body', issues: parsed.error.issues }, 400)
  }

  try {
    await syncManifest(site.id, parsed.data)
  } catch (error) {
    if (error instanceof Error && error.name === 'ValidationError')
      return json({ error: 'Invalid identifiers', issues: error.message }, 400)
    throw error
  }
  return json({ ok: true as const })
}

export const Route = createFileRoute('/api/sites/manifest')({
  server: {
    handlers: {
      GET: ({ request }) => getSitesManifest(request),
      POST: ({ request }) => postSitesManifest(request),
    },
  },
})
