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
import { TRANSLATABLE_BY_DEFAULT } from '#/lib/content-locale'
import { GLOBAL_GROUP_MAX_LENGTH } from '#/lib/globals'
import type { Field, FieldType, SiteLanguages } from '#/lib/types'
import { m } from '#/paraglide/messages'

/**
 * Pure helpers of the schema editor (moved from the old
 * `components/admin/collection-form.tsx`): field drafts, key suggestions, the
 * dirty fingerprint and per-row validation.
 *
 * `kind` picks the rules: `collection` (default) forces the locked slug row
 * and has no group headings; `global` (site content section) has no slug row,
 * forbids the slug type and allows an optional `group` heading per field.
 */

export type SchemaKind = 'collection' | 'global'

export type SchemaOptions = { kind?: SchemaKind }

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
  /** Site content only: visual heading above this field ('' when unset). */
  group: string
  /**
   * Date fields: the key of the date field this must be on or after ('' when
   * unset). Not edited here, but it is stored, so a save keeps it.
   */
  after: string
  /**
   * The explicit "Translatable" switch. Undefined follows the field type's
   * default (`TRANSLATABLE_BY_DEFAULT`). Only written when it differs from it.
   */
  translatable?: boolean
}

export type CollectionDraft = {
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

/**
 * Per-language settings of a collection or section, edited next to the
 * fields. `requiredLanguages` never holds the main language (it is implied).
 * `routes` holds one pattern per non-main language; blank means "use main".
 */
export type LanguageSettingsDraft = {
  requiredLanguages: string[]
  routes: Record<string, string>
}

export type FieldErrors = Partial<
  Record<
    number,
    { key?: string; label?: string; type?: string; group?: string }
  >
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

/** Whether a field draft is written per language, following the type default. */
export function draftTranslatable(
  field: Pick<FieldDraft, 'type' | 'translatable'>,
) {
  if (field.type === 'slug') return false
  return field.translatable ?? TRANSLATABLE_BY_DEFAULT[field.type]
}

/** Whether a field is written per language (the Languages switch). */
export function fieldTranslatable(field: Field) {
  return draftTranslatable({
    type: field.type,
    translatable: field.translatable,
  })
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
    group: '',
    after: '',
    translatable: undefined,
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
    group: field.group ?? '',
    after: field.after ?? '',
    translatable: field.translatable,
  }
}

export function draftsFromFields(
  fields: Field[] | undefined,
  { kind = 'collection' }: SchemaOptions = {},
) {
  if (kind === 'global') return (fields ?? []).map(toFieldDraft)
  return withRequiredSlugField(fields ?? [REQUIRED_SLUG_FIELD]).map(
    toFieldDraft,
  )
}

export function fieldsFromDrafts(
  drafts: FieldDraft[],
  { kind = 'collection' }: SchemaOptions = {},
): Field[] {
  return drafts.map((field) => {
    const saved: Field = {
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
      after: field.after.trim() || undefined,
    }
    if (kind === 'global') saved.group = field.group.trim() || undefined
    // Stored only when it differs from the type default, so a field that
    // follows its default keeps no key.
    if (
      field.translatable !== undefined &&
      field.type !== 'slug' &&
      field.translatable !== TRANSLATABLE_BY_DEFAULT[field.type]
    ) {
      saved.translatable = field.translatable
    }
    return saved
  })
}

/**
 * Required languages as the server stores them: site languages besides main,
 * in site order, without duplicates.
 */
export function requiredLanguagesFrom(
  picked: string[],
  languages: SiteLanguages,
): string[] {
  return languages.all.filter(
    (locale) => locale !== languages.main && picked.includes(locale),
  )
}

/**
 * Route patterns as the server stores them: non-empty, trimmed, non-main
 * languages only. Null when none are set (clears them on the server).
 */
export function localizedRoutesFrom(
  routes: Partial<Record<string, string>>,
  languages: SiteLanguages,
): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const locale of languages.all) {
    if (locale === languages.main) continue
    const pattern = routes[locale]?.trim()
    if (pattern) out[locale] = pattern
  }
  return Object.keys(out).length > 0 ? out : null
}

/** The stored route patterns as the editor's draft (every non-main language). */
export function routesDraftFrom(
  stored: Record<string, string> | null | undefined,
): Record<string, string> {
  return { ...(stored ?? {}) }
}

/** Comparable shape for the dirty check: ids and UI-only flags dropped. */
export function draftFingerprint(
  drafts: FieldDraft[],
  options: SchemaOptions = {},
) {
  return JSON.stringify(fieldsFromDrafts(drafts, options))
}

/** Per-row errors: empty keys or labels; in sections, slug type and group length. */
export function validateFieldDrafts(
  drafts: FieldDraft[],
  { kind = 'collection' }: SchemaOptions = {},
): FieldErrors {
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
    if (kind === 'global') {
      if (field.type === 'slug') {
        errors[index] = {
          ...errors[index],
          type: m.globals_slug_forbidden(),
        }
      }
      if (field.group.trim().length > GLOBAL_GROUP_MAX_LENGTH) {
        errors[index] = {
          ...errors[index],
          group: m.globals_group_too_long({ max: GLOBAL_GROUP_MAX_LENGTH }),
        }
      }
    }
  })
  return errors
}
