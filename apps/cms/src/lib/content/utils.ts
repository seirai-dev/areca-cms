import type { EntryData, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function firstTextField(fields: Field[]) {
  return fields.find((field) => field.type === 'text')
}

export function entryTitle(data: EntryData, fields: Field[], slug: string) {
  const textField = firstTextField(fields)
  if (textField) {
    const value = data[textField.key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return slug
}

export function formatDateTime(value: unknown) {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export function toDatetimeLocalValue(value: unknown) {
  if (value == null || value === '') return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromDatetimeLocalValue(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

export function shortId(id: string, length = 8) {
  return id.slice(0, length)
}

export function assetFileUrl(storageKey: string) {
  return `/api/assets/file/${storageKey}`
}

export function emptyRichText() {
  return { type: 'doc' as const, content: [{ type: 'paragraph' as const }] }
}

function defaultFieldValue(field: Field): unknown {
  switch (field.type) {
    case 'boolean':
      return false
    case 'number':
      return null
    case 'richtext':
      return emptyRichText()
    default:
      return ''
  }
}

export function initialEntryData(
  fields: Field[],
  existing?: EntryData,
): EntryData {
  const data: EntryData = {}
  for (const field of fields) {
    const current = existing?.[field.key]
    data[field.key] = current === undefined ? defaultFieldValue(field) : current
  }
  return data
}

export type FieldErrorMap = Record<string, string>

export function fieldErrorsFromUnknown(error: unknown): {
  formError?: string
  fieldErrors: FieldErrorMap
} {
  const fieldErrors: FieldErrorMap = {}
  const source = error as
    | {
        errors?: Array<{ path?: string; message?: string }>
        message?: string
      }
    | null
    | undefined

  if (Array.isArray(source?.errors)) {
    for (const item of source.errors) {
      const path = item.path ?? ''
      const message = item.message ?? m.editor_invalid()
      if (path) fieldErrors[path] = message
      else if (!fieldErrors['']) fieldErrors[''] = message
    }
  } else if (typeof source?.message === 'string') {
    for (const part of source.message.split('; ')) {
      const idx = part.indexOf(': ')
      if (idx > 0) {
        const path = part.slice(0, idx)
        const message = part.slice(idx + 2)
        if (path && !path.includes(' ')) fieldErrors[path] = message
      }
    }
    if (Object.keys(fieldErrors).length === 0) {
      return { formError: source.message, fieldErrors }
    }
  } else {
    return {
      formError:
        error instanceof Error
          ? error.message
          : m.editor_something_went_wrong(),
      fieldErrors,
    }
  }

  return {
    formError: fieldErrors[''] || undefined,
    fieldErrors,
  }
}

export function errorMessage(
  error: unknown,
  fallback = m.editor_something_went_wrong(),
) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const COMMON_TIMEZONES = [
  'UTC',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
]

export function timezoneOptions() {
  const current = browserTimezone()
  const set = new Set([current, ...COMMON_TIMEZONES])
  return [...set]
}
