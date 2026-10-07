import { richTextAssetsAuthorized } from '#/server/assets/richtext-ownership'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { asset, collection, entry } from '#/db/schema'
import {
  ENTRY_DATA_MAX_BYTES,
  ID_MAX_LENGTH,
  SELECT_VALUE_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  TEXTAREA_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  URL_MAX_LENGTH,
} from '#/lib/content-limits'
import type { EntryData, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { validateRichText } from '#/server/richtext'

import { getCollection } from './collections.ts'

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export type FieldError = { path: string; message: string }

export type ValidateEntryResult =
  { ok: true; data: EntryData } | { ok: false; errors: FieldError[] }

export type SchemaMode = 'strict' | 'partial'

function isIsoDateTime(value: string) {
  return ISO_DATETIME.test(value) && !Number.isNaN(Date.parse(value))
}

export function isEmptyRichText(value: unknown): boolean {
  if (value == null || value === '') return true
  if (typeof value !== 'object' || Array.isArray(value)) return false
  const doc = value as { type?: string; content?: unknown[] }
  if (doc.type !== 'doc') return false
  const content = doc.content ?? []
  if (content.length === 0) return true
  return content.every((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    const item = node as { type?: string; content?: unknown[] }
    return (
      item.type === 'paragraph' && (!item.content || item.content.length === 0)
    )
  })
}

function wrap(
  schema: z.ZodType,
  field: Field,
  mode: SchemaMode,
  allowEmptyString: boolean,
): z.ZodType {
  const empty: [z.ZodType, ...z.ZodType[]] = allowEmptyString
    ? [z.null(), z.literal('')]
    : [z.null()]

  if (mode === 'partial' || !field.required) {
    return z.union([schema, ...empty]).optional()
  }
  return schema
}

function schemaForField(field: Field, mode: SchemaMode): z.ZodType {
  switch (field.type) {
    case 'text':
    case 'textarea': {
      const max = field.type === 'text' ? TEXT_MAX_LENGTH : TEXTAREA_MAX_LENGTH
      if (field.required) {
        return z.string().min(1, m.server_required()).max(max)
      }
      return wrap(z.string().max(max), field, mode, true)
    }
    case 'slug':
      if (field.required) {
        return z
          .string()
          .min(1, m.server_required())
          .max(SLUG_MAX_LENGTH)
          .regex(SLUG_PATTERN, m.server_invalid_slug())
      }
      return wrap(
        z
          .string()
          .max(SLUG_MAX_LENGTH)
          .regex(SLUG_PATTERN, m.server_invalid_slug()),
        field,
        mode,
        true,
      )
    case 'richtext': {
      const richtext = z.any().superRefine((value, ctx) => {
        if (isEmptyRichText(value)) {
          if (mode === 'strict' && field.required) {
            ctx.addIssue({ code: 'custom', message: m.server_required() })
          }
          return
        }
        for (const message of validateRichText(value)) {
          ctx.addIssue({ code: 'custom', message })
        }
      })
      if (mode === 'partial' || !field.required) {
        return richtext.optional()
      }
      return richtext
    }
    case 'image':
    case 'reference':
      return wrap(
        field.required && mode === 'strict'
          ? z.string().min(1).max(ID_MAX_LENGTH)
          : z.string().max(ID_MAX_LENGTH),
        field,
        mode,
        true,
      )
    case 'date':
      return wrap(z.iso.date(), field, mode, true)
    case 'datetime':
      return wrap(
        z.string().max(64).refine(isIsoDateTime, {
          message: m.server_invalid_datetime(),
        }),
        field,
        mode,
        true,
      )
    case 'select': {
      const options = field.options ?? []
      const selectSchema =
        options.length > 0
          ? z
              .string()
              .max(SELECT_VALUE_MAX_LENGTH)
              .refine((value) => options.includes(value), {
                message: m.server_select_must_be_one_of({
                  options: options.join(', '),
                }),
              })
          : z.string().max(SELECT_VALUE_MAX_LENGTH)
      return wrap(selectSchema, field, mode, true)
    }
    case 'boolean':
      return wrap(z.boolean(), field, mode, false)
    case 'number':
      return wrap(z.number(), field, mode, false)
    case 'url':
      return wrap(
        z
          .string()
          .max(URL_MAX_LENGTH)
          .url()
          .refine(
            (value) => {
              try {
                const parsed = new URL(value)
                return (
                  parsed.protocol === 'http:' || parsed.protocol === 'https:'
                )
              } catch {
                return false
              }
            },
            { message: m.server_invalid_url() },
          ),
        field,
        mode,
        true,
      )
  }
}

export function buildEntrySchema(
  fields: Field[],
  options: { mode?: SchemaMode } = {},
): z.ZodType {
  const mode = options.mode ?? 'strict'
  const shape: Record<string, z.ZodType> = {}
  for (const field of fields) {
    shape[field.key] = schemaForField(field, mode)
  }
  // Unknown keys are stripped here; writes reject them first (see
  // `findUnknownKeys` in `validateEntryData`).
  return z.object(shape)
}

/** Keys of `data` that no field declares. Own enumerable keys only. */
export function findUnknownKeys(
  fields: Field[],
  data: Record<string, unknown>,
): string[] {
  const declared = new Set(fields.map((field) => field.key))
  return Object.keys(data).filter((key) => !declared.has(key))
}

/**
 * Copy of `data` holding only declared fields. Use this for stored data that
 * may predate a schema change (removed fields) before exporting it.
 */
export function pickDeclaredFields(
  fields: Field[],
  data: Record<string, unknown>,
): EntryData {
  const out: EntryData = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(data, field.key)) {
      out[field.key] = data[field.key] as EntryData[string]
    }
  }
  return out
}

function entryDataTooLarge(data: unknown): boolean {
  try {
    const json = JSON.stringify(data)
    return Buffer.byteLength(json ?? '', 'utf8') > ENTRY_DATA_MAX_BYTES
  } catch {
    // Unserializable or nested past the engine's stack: reject either way.
    return true
  }
}

export function validateEntryData(
  fields: Field[],
  data: unknown,
  options: {
    mode?: SchemaMode
    /**
     * Set for incoming writes: unknown keys are rejected (instead of silently
     * stripped) and the total serialized size is capped.
     */
    write?: boolean
  } = {},
): ValidateEntryResult {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      errors: [{ path: '', message: m.server_expected_object() }],
    }
  }

  if (options.write) {
    const unknown = findUnknownKeys(fields, data as Record<string, unknown>)
    if (unknown.length > 0) {
      return {
        ok: false,
        errors: unknown.slice(0, 20).map((key) => ({
          path: key,
          message: `Unknown field "${key}"`,
        })),
      }
    }
    if (entryDataTooLarge(data)) {
      return {
        ok: false,
        errors: [
          {
            path: '',
            message: `Entry data is larger than ${ENTRY_DATA_MAX_BYTES} bytes or nested too deeply`,
          },
        ],
      }
    }
  }

  const result = buildEntrySchema(fields, options).safeParse(data)
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }
  }

  const parsed = result.data as EntryData
  const dateErrors = validateDateOrder(fields, parsed)
  if (dateErrors.length > 0) {
    return { ok: false, errors: dateErrors }
  }

  return { ok: true, data: parsed }
}

function validateDateOrder(fields: Field[], data: EntryData): FieldError[] {
  const errors: FieldError[] = []
  for (const field of fields) {
    if ((field.type !== 'date' && field.type !== 'datetime') || !field.after) {
      continue
    }
    const value = data[field.key]
    const other = data[field.after]
    if (typeof value !== 'string' || value === '') continue
    if (typeof other !== 'string' || other === '') continue
    if (Date.parse(value) < Date.parse(other)) {
      errors.push({
        path: field.key,
        message: m.server_must_be_on_or_after({ path: field.after }),
      })
    }
  }
  return errors
}

export async function validateReferences(
  siteId: string,
  fields: Field[],
  data: EntryData,
  options: { requirePublished?: boolean } = {},
): Promise<FieldError[]> {
  const errors: FieldError[] = []

  for (const field of fields) {
    if (field.type !== 'reference') continue
    const value = data[field.key]
    if (value == null || value === '') continue
    if (typeof value !== 'string') {
      errors.push({
        path: field.key,
        message: m.server_expected_entry_id(),
      })
      continue
    }
    if (!field.collection) {
      errors.push({
        path: field.key,
        message: m.server_reference_missing_collection(),
      })
      continue
    }

    const refCollection = await getCollection(siteId, field.collection)
    if (!refCollection) {
      errors.push({
        path: field.key,
        message: m.server_unknown_collection({
          collection: field.collection,
        }),
      })
      continue
    }

    const [ref] = await db
      .select({ id: entry.id, status: entry.status })
      .from(entry)
      .where(and(eq(entry.id, value), eq(entry.collectionId, refCollection.id)))
      .limit(1)

    if (!ref) {
      errors.push({
        path: field.key,
        message: m.server_referenced_entry_not_found(),
      })
      continue
    }
    if (options.requirePublished !== false && ref.status !== 'published') {
      errors.push({
        path: field.key,
        message: m.server_referenced_entry_not_published(),
      })
    }
  }

  return errors
}

export function resolveSlug(
  data: EntryData,
  fields: Field[],
): string | undefined {
  if (typeof data.slug === 'string' && data.slug.length > 0) {
    return data.slug
  }
  const slugField = fields.find((field) => field.type === 'slug')
  if (!slugField) return undefined
  const value = data[slugField.key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Drafts may be incomplete, but supplied IDs must belong to their authorized scope. */
export async function validateContentOwnership(
  siteId: string,
  organizationId: string,
  fields: Field[],
  data: EntryData,
  connection: Pick<typeof db, 'select'> = db,
) {
  const errors: FieldError[] = []
  for (const field of fields) {
    const value = data[field.key]
    if (
      field.type === 'richtext' &&
      !(await richTextAssetsAuthorized(value, organizationId, connection))
    ) {
      errors.push({
        path: field.key,
        message: 'Embedded asset not found in this organization',
      })
    }
    if (typeof value !== 'string' || !value) continue
    if (field.type === 'reference') {
      const [found] = field.collection
        ? await connection
            .select({ id: entry.id })
            .from(entry)
            .innerJoin(collection, eq(entry.collectionId, collection.id))
            .where(
              and(
                eq(entry.id, value),
                eq(entry.siteId, siteId),
                eq(collection.key, field.collection),
              ),
            )
            .limit(1)
        : []
      if (!found)
        errors.push({
          path: field.key,
          message: m.server_referenced_entry_not_found(),
        })
    }
    if (field.type === 'image') {
      const [found] = await connection
        .select({ id: asset.id })
        .from(asset)
        .where(
          and(eq(asset.id, value), eq(asset.organizationId, organizationId)),
        )
        .limit(1)
      if (!found)
        errors.push({
          path: field.key,
          message: 'Asset not found in this organization',
        })
    }
  }
  return errors
}
