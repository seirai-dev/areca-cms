import type { CollectionConfig, Field, GlobalConfig, Snapshot } from './types.js'

/** Most problems listed in one error. */
const MAX_PROBLEMS = 20

/** Types whose optional value may also be sent as an empty string. */
const EMPTY_STRING_OK = new Set<Field['type']>([
  'text',
  'textarea',
  'url',
  'slug',
  'select',
  'date',
  'datetime',
  'image',
  'reference',
  'richtext',
])

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Checks a raw publication against its schema (spec section 3), before any
 * key is camelised or anything is written. Throws one error that lists up to
 * 20 problems as `<collection>/<slug>.<field>: <problem>`, and
 * `globals/<key>.<field>: <problem>` for site content sections.
 */
export function validateSnapshot(
  snapshot: Snapshot,
  schema: Record<string, CollectionConfig>,
): void {
  const problems: string[] = []
  for (const [collection, entries] of Object.entries(snapshot.collections)) {
    const config = schema[collection]
    if (!config) throw new Error(`Collection "${collection}" has no schema`)
    for (const entry of entries) {
      const prefix = `${collection}/${entry.slug}`
      for (const issue of entryIssues(entry.data, config.fields)) {
        problems.push(`${prefix}.${issue.field}: ${issue.problem}`)
      }
    }
  }
  for (const [key, global] of Object.entries(snapshot.globals ?? {})) {
    const config: GlobalConfig | undefined = snapshot.globalSchema?.[key]
    if (!config) throw new Error(`Global "${key}" has no schema`)
    for (const issue of entryIssues(global.data, config.fields)) {
      problems.push(`globals/${key}.${issue.field}: ${issue.problem}`)
    }
  }
  if (problems.length === 0) return
  const listed = problems.slice(0, MAX_PROBLEMS)
  const more = problems.length - listed.length
  throw new Error(
    [
      'Publication does not match its schema:',
      ...listed,
      ...(more > 0 ? [`...and ${more} more`] : []),
    ].join('\n'),
  )
}

/** One problem with a raw entry. `field` is the raw CMS key, or `data` when the data is not an object. */
export type EntryIssue = { field: string; problem: string }

/**
 * Checks one raw entry's `data` against its fields (spec section 3). Returns
 * the problems in field order, unknown keys first; empty when valid. Used by
 * `validateSnapshot` and by `content.preview()`.
 */
export function entryIssues(data: unknown, fields: readonly Field[]): EntryIssue[] {
  if (!isRecord(data)) return [{ field: 'data', problem: 'must be an object' }]
  const issues: EntryIssue[] = []
  const known = new Set(fields.map((field) => field.key))
  for (const key of Object.keys(data)) {
    if (!known.has(key)) issues.push({ field: key, problem: 'unknown field' })
  }
  for (const field of fields) {
    const problem = fieldProblem(data, field)
    if (problem !== undefined) issues.push({ field: field.key, problem })
  }
  return issues
}

/** Returns the problem with one field's value, or `undefined` when it is valid. */
function fieldProblem(
  data: Record<string, unknown>,
  field: Field,
): string | undefined {
  const value = data[field.key]
  if (value === undefined || value === null || value === '') {
    if (field.required) return 'is required'
    if (value === undefined || value === null) return undefined
    return EMPTY_STRING_OK.has(field.type) ? undefined : shapeProblem(value, field)
  }
  return shapeProblem(value, field)
}

function shapeProblem(value: unknown, field: Field): string | undefined {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'url':
    case 'slug':
      return typeof value === 'string' ? undefined : 'must be a string'
    case 'select':
      if (typeof value !== 'string') return 'must be a string'
      if (field.options?.length && !field.options.includes(value)) {
        return `must be one of ${field.options.map((option) => JSON.stringify(option)).join(', ')}`
      }
      return undefined
    case 'date':
      return isDate(value) ? undefined : 'must be a YYYY-MM-DD date'
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? undefined
        : 'must be a date and time'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : 'must be a finite number'
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'must be a boolean'
    case 'image':
      return isImage(value) ? undefined : 'must be an image object'
    case 'reference':
      return isReference(value, field.collection)
        ? undefined
        : `must be a reference to ${field.collection}`
    case 'richtext':
      return isRichText(value) ? undefined : 'must be a rich text object'
  }
}

function isDate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value)
}

function isImage(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    isNumberOrNull(value.width) &&
    isNumberOrNull(value.height) &&
    typeof value.alt === 'string' &&
    typeof value.mimeType === 'string'
  )
}

function isReference(value: unknown, collection: string): boolean {
  return (
    isRecord(value) &&
    value.collection === collection &&
    typeof value.slug === 'string' &&
    typeof value.id === 'string'
  )
}

function isRichText(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.markdown === 'string' &&
    typeof value.html === 'string' &&
    isRecord(value.document) &&
    value.json !== undefined
  )
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
