import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { ID_MAX_LENGTH, ENTRY_DATA_MAX_BYTES } from '#/lib/content-limits'
import { withRequiredSlugField } from '#/lib/collection-fields'
import { localeTagSchema } from '#/lib/content-locale'
import { SLUG_PATTERN } from '#/lib/slug'
import { z } from '#/lib/zod'
import { securityErrorCode } from '#/lib/security-errors'
import { getSession } from '#/lib/session.server'
import {
  requireEntryAccess,
  requireGlobalAccess,
} from '#/server/content/access'
import { normalizeEntryData } from '#/server/content/entries'
import {
  buildPreviewEntryFromDraft,
  buildPreviewGlobalFromDraft,
} from '#/server/content/snapshot'
import { NotFoundError } from '#/server/content/errors'
import { entryDataSchema, validateEntryData } from '#/server/content/validation'

// Unsaved editor content: never let a browser, proxy or CDN keep it.
const NO_STORE = { 'Cache-Control': 'no-store, private' }

// The entry data cap plus room for the envelope (ids, locale, JSON framing).
const MAX_BODY_BYTES = ENTRY_DATA_MAX_BYTES + 64 * 1024

const bodySchema = z
  .object({
    siteId: z.string().min(1).max(ID_MAX_LENGTH),
    entryId: z.string().min(1).max(ID_MAX_LENGTH).optional(),
    collection: z.string().min(1).max(ID_MAX_LENGTH).optional(),
    global: z.string().min(1).max(ID_MAX_LENGTH).optional(),
    data: entryDataSchema,
    locale: localeTagSchema.nullable().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.entryId !== undefined && body.global === undefined) {
      if (body.collection === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'collection is required with entryId',
          path: ['collection'],
        })
      }
      return
    }
    if (body.global !== undefined && body.entryId === undefined) {
      if (body.collection !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'collection is not used with global',
          path: ['collection'],
        })
      }
      return
    }
    ctx.addIssue({
      code: 'custom',
      message: 'Send exactly one of entryId or global',
      path: ['entryId'],
    })
  })

type LiveBody = z.infer<typeof bodySchema>

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE })
}

function notFound() {
  return json({ error: 'Not found' }, 404)
}

/** The request body as text, or null when it passes the cap (chunked or not). */
async function readCappedText(request: Request): Promise<string | null> {
  const declared = request.headers.get('content-length')
  if (declared && Number(declared) > MAX_BODY_BYTES) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Builds exactly what `/api/sites/preview` returns for the entry or section,
 * but from the unsaved `data` the editor sends. Authorization is the same as
 * `updateDraftFn` / `updateGlobalDraftFn`. Writes nothing.
 */
async function previewUnsaved(body: LiveBody) {
  if (body.entryId !== undefined) {
    const {
      site,
      entry: existing,
      collection: entryCollection,
    } = await requireEntryAccess(body.entryId)
    // Same answer for an entry of another site as for a missing one.
    if (existing.siteId !== body.siteId) throw new NotFoundError()
    if (existing.collectionKey !== body.collection) throw new NotFoundError()
    // A section entry is not previewed as a collection entry.
    if (entryCollection.kind !== 'collection') throw new NotFoundError()
    const col = {
      ...entryCollection,
      fields: withRequiredSlugField(entryCollection.fields),
    }

    const slugField = col.fields.find((field) => field.type === 'slug')
    let data = normalizeEntryData({ site, collection: col }, body.data)
    // A slug still being typed (empty, malformed) would fail validation. The
    // page keeps showing the saved slug until the typed one is valid.
    if (slugField && slugField.key in data) {
      const typed = data[slugField.key]
      if (typeof typed !== 'string' || !SLUG_PATTERN.test(typed)) {
        data = { ...data, [slugField.key]: existing.slug }
      }
    }

    const validated = validateEntryData(col.fields, data, {
      mode: 'partial',
      write: true,
    })
    if (!validated.ok) {
      return json(
        { error: 'Invalid entry data', errors: validated.errors },
        400,
      )
    }

    const unsaved = slugField ? validated.data[slugField.key] : undefined
    const slug =
      typeof unsaved === 'string' && SLUG_PATTERN.test(unsaved)
        ? unsaved
        : existing.slug

    const entry = await buildPreviewEntryFromDraft({
      site,
      collection: col,
      entryRow: { id: existing.id, slug, publishedAt: existing.publishedAt },
      draftData: validated.data,
      locale: body.locale || null,
    })
    return json({
      kind: 'entry' as const,
      collection: col.key,
      slug,
      entry,
    })
  }

  if (body.global === undefined) return notFound()
  const {
    site,
    global,
    entry: row,
  } = await requireGlobalAccess(body.siteId, body.global)
  const validated = validateEntryData(
    global.fields,
    normalizeEntryData({ site, collection: global }, body.data),
    { mode: 'partial', write: true },
  )
  if (!validated.ok) {
    return json({ error: 'Invalid entry data', errors: validated.errors }, 400)
  }
  const section = await buildPreviewGlobalFromDraft({
    site,
    global,
    entryRow: row,
    draftData: validated.data,
    locale: body.locale || null,
  })
  if (!section) return notFound()
  return json({
    kind: 'global' as const,
    global: body.global,
    entry: section,
  })
}

export async function postLivePreview(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session || session.user.blockedAt) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const text = await readCappedText(request)
  if (text === null) return json({ error: 'Payload too large' }, 413)

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return json({ error: 'Invalid request' }, 400)

  try {
    return await previewUnsaved(parsed.data)
  } catch (error) {
    if (error instanceof NotFoundError) return notFound()
    if (error instanceof Response) return error
    // Agency admin without two-factor, or a stale step-up: the same 403 codes
    // the upload routes send.
    const code = securityErrorCode(error)
    if (code) return new Response(code, { status: 403, headers: NO_STORE })
    throw error
  }
}

export const Route = createFileRoute('/api/editor/live-preview')({
  server: {
    handlers: {
      POST: ({ request }) => postLivePreview(request),
    },
  },
})
