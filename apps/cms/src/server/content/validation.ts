import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { entry } from '#/db/schema'
import type { EntryData, Field } from '#/lib/types'
import { validateRichText } from '#/server/richtext'

import { getCollection } from './collections.ts'

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export type FieldError = { path: string; message: string }

export type ValidateEntryResult =
  | { ok: true; data: EntryData }
  | { ok: false; errors: FieldError[] }

export type SchemaMode = 'strict' | 'partial'

function isIsoDateTime(value: string) {
  return ISO_DATETIME.test(value) && !Number.isNaN(Date.parse(value))
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
    case 'textarea':
      return wrap(
        field.required && mode === 'strict'
          ? z.string().min(1)
          : z.string(),
        field,
        mode,
        true,
      )
    case 'slug':
      return wrap(
        z.string().regex(SLUG_PATTERN, 'Invalid slug'),
        field,
        mode,
        true,
      )
    case 'richtext': {
      const richtext = z.any().superRefine((value, ctx) => {
        if (value == null || value === '') {
          if (mode === 'strict' && field.required) {
            ctx.addIssue({ code: 'custom', message: 'Required' })
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
          ? z.string().min(1)
          : z.string(),
        field,
        mode,
        true,
      )
    case 'date':
      return wrap(z.iso.date(), field, mode, true)
    case 'datetime':
      return wrap(
        z.string().refine(isIsoDateTime, { message: 'Invalid datetime' }),
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
              .refine((value) => options.includes(value), {
                message: `Must be one of: ${options.join(', ')}`,
              })
          : z.string()
      return wrap(selectSchema, field, mode, true)
    }
    case 'boolean':
      return wrap(z.boolean(), field, mode, false)
    case 'number':
      return wrap(z.number(), field, mode, false)
    case 'url':
      return wrap(
        z.string().url().refine(
          (value) => {
            try {
              const parsed = new URL(value)
              return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            } catch {
              return false
            }
          },
          { message: 'Invalid URL' },
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
  return z.object(shape).passthrough()
}

export function validateEntryData(
  fields: Field[],
  data: unknown,
  options: { mode?: SchemaMode } = {},
): ValidateEntryResult {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: [{ path: '', message: 'Expected an object' }] }
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
        message: `Must be on or after ${field.after}`,
      })
    }
  }
  return errors
}

export async function validateReferences(
  siteId: string,
  fields: Field[],
  data: EntryData,
): Promise<FieldError[]> {
  const errors: FieldError[] = []

  for (const field of fields) {
    if (field.type !== 'reference') continue
    const value = data[field.key]
    if (value == null || value === '') continue
    if (typeof value !== 'string') {
      errors.push({ path: field.key, message: 'Expected an entry id' })
      continue
    }
    if (!field.collection) {
      errors.push({
        path: field.key,
        message: 'Reference field is missing a collection',
      })
      continue
    }

    const refCollection = await getCollection(siteId, field.collection)
    if (!refCollection) {
      errors.push({
        path: field.key,
        message: `Unknown collection "${field.collection}"`,
      })
      continue
    }

    const [ref] = await db
      .select({ id: entry.id, status: entry.status })
      .from(entry)
      .where(
        and(eq(entry.id, value), eq(entry.collectionId, refCollection.id)),
      )
      .limit(1)

    if (!ref) {
      errors.push({ path: field.key, message: 'Referenced entry not found' })
      continue
    }
    if (ref.status !== 'published') {
      errors.push({
        path: field.key,
        message: 'Referenced entry is not published',
      })
    }
  }

  return errors
}

export function resolveSlug(data: EntryData, fields: Field[]): string | undefined {
  if (typeof data.slug === 'string' && data.slug.length > 0) {
    return data.slug
  }
  const slugField = fields.find((field) => field.type === 'slug')
  if (!slugField) return undefined
  const value = data[slugField.key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
