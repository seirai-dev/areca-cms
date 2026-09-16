import type { Field } from './types'

export const REQUIRED_SLUG_FIELD: Field = {
  key: 'slug',
  label: 'Slug',
  type: 'slug',
  required: true,
}

/** Keep the entry slug invariant true for UI, API, and manifest collections. */
export function withRequiredSlugField(fields: Field[]): Field[] {
  const remaining = fields.filter((field) => field.key !== 'slug')
  return [{ ...REQUIRED_SLUG_FIELD }, ...remaining]
}
