import {
  Calendar,
  CalendarDots,
  Hash,
  Image,
  Link,
  LinkSimple,
  ListChecks,
  Paragraph,
  TextAa,
  TextAlignLeft,
  TextT,
  ToggleLeft,
} from '@phosphor-icons/react'
import type { Icon as IconComponent } from '@phosphor-icons/react'

import { FIELD_TYPES } from '#/lib/admin/helpers'
import {
  REQUIRED_SLUG_FIELD,
  withRequiredSlugField,
} from '#/lib/collection-fields'
import type { Field, FieldType } from '#/lib/types'
import { m } from '#/paraglide/messages'

/**
 * Pure helpers of the schema editor (moved from the old
 * `components/admin/collection-form.tsx`, behaviour unchanged): field drafts,
 * key suggestions, the dirty fingerprint and per-row validation.
 */

export type FieldDraft = {
  /** Stable identity for reordering; never sent to the server. */
  id: string
  key: string
  label: string
  type: FieldType
  required: boolean
  options: string[]
  collection: string
  description: string
  /** False until the user edits the key by hand, so it follows the label. */
  keyTouched: boolean
}

export type CollectionDraft = {
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

export type FieldErrors = Partial<
  Record<number, { key?: string; label?: string }>
>

export const FIELD_TYPE_ICONS: Record<FieldType, IconComponent> = {
  text: TextT,
  textarea: TextAlignLeft,
  richtext: Paragraph,
  image: Image,
  date: Calendar,
  datetime: CalendarDots,
  select: ListChecks,
  reference: LinkSimple,
  slug: TextAa,
  boolean: ToggleLeft,
  number: Hash,
  url: Link,
}

/** Types offered when adding a field (the slug field is built in). */
export const PICKABLE_FIELD_TYPES = FIELD_TYPES.filter(
  (type) => type !== 'slug',
)

/** Human name of a field type ("Short text", "Image"…). */
export function fieldTypeName(type: FieldType) {
  switch (type) {
    case 'text':
      return m.content_type_text()
    case 'textarea':
      return m.content_type_textarea()
    case 'richtext':
      return m.content_type_richtext()
    case 'image':
      return m.content_type_image()
    case 'date':
      return m.content_type_date()
    case 'datetime':
      return m.content_type_datetime()
    case 'select':
      return m.content_type_select()
    case 'reference':
      return m.content_type_reference()
    case 'slug':
      return m.content_type_slug()
    case 'boolean':
      return m.content_type_boolean()
    case 'number':
      return m.content_type_number()
    case 'url':
      return m.content_type_url()
  }
}

export function fieldTypeDescription(type: FieldType) {
  switch (type) {
    case 'text':
      return m.admin_field_desc_text()
    case 'textarea':
      return m.admin_field_desc_textarea()
    case 'richtext':
      return m.admin_field_desc_richtext()
    case 'image':
      return m.admin_field_desc_image()
    case 'date':
      return m.admin_field_desc_date()
    case 'datetime':
      return m.admin_field_desc_datetime()
    case 'select':
      return m.admin_field_desc_select()
    case 'reference':
      return m.admin_field_desc_reference()
    case 'slug':
      return m.admin_field_desc_slug()
    case 'boolean':
      return m.admin_field_desc_boolean()
    case 'number':
      return m.admin_field_desc_number()
    case 'url':
      return m.admin_field_desc_url()
  }
}

let draftSeq = 0
function nextDraftId() {
  draftSeq += 1
  return `fd-${draftSeq}`
}

/** `Hero image` becomes `heroImage`, the convention used by the SDK. */
export function keyFromLabel(label: string) {
  const words = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (words.length === 0) return ''
  return words
    .map((word, index) =>
      index === 0 ? word : word[0].toUpperCase() + word.slice(1),
    )
    .join('')
}

/** `Blog posts` becomes `blog-posts`, matching the manifest convention. */
export function slugifyKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function emptyFieldDraft(type: FieldType = 'text'): FieldDraft {
  return {
    id: nextDraftId(),
    key: '',
    label: '',
    type,
    required: false,
    options: [],
    collection: '',
    description: '',
    keyTouched: false,
  }
}

function toFieldDraft(field: Field): FieldDraft {
  return {
    id: nextDraftId(),
    key: field.key,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    options: [...(field.options ?? [])],
    collection: field.collection ?? '',
    description: field.description ?? '',
    keyTouched: true,
  }
}

export function draftsFromFields(fields: Field[] | undefined) {
  return withRequiredSlugField(fields ?? [REQUIRED_SLUG_FIELD]).map(
    toFieldDraft,
  )
}

export function fieldsFromDrafts(drafts: FieldDraft[]): Field[] {
  return drafts.map((field) => ({
    key: field.key.trim(),
    label: field.label.trim(),
    type: field.type,
    required: field.required || undefined,
    description: field.description.trim() || undefined,
    options:
      field.type === 'select'
        ? field.options.filter((option) => option.trim().length > 0)
        : undefined,
    collection:
      field.type === 'reference'
        ? field.collection.trim() || undefined
        : undefined,
  }))
}

/** Comparable shape for the dirty check: ids and UI-only flags dropped. */
export function draftFingerprint(drafts: FieldDraft[]) {
  return JSON.stringify(fieldsFromDrafts(drafts))
}

/** Returns per-row errors for empty keys or labels. */
export function validateFieldDrafts(drafts: FieldDraft[]): FieldErrors {
  const errors: FieldErrors = {}
  drafts.forEach((field, index) => {
    if (!field.key.trim()) {
      errors[index] = {
        ...errors[index],
        key: m.admin_collection_field_key_required(),
      }
    }
    if (!field.label.trim()) {
      errors[index] = {
        ...errors[index],
        label: m.admin_collection_field_label_required(),
      }
    }
  })
  return errors
}
