import { isTranslatable } from '#/lib/content-locale'
import type { Field, FieldType } from '#/lib/types'

import { CODE_FORMAT } from './rich-text-guide'

/**
 * Agent-facing documentation of content fields: the format each field type
 * takes, and an example payload an agent can copy and adapt.
 */

const TYPE_FORMAT: Record<FieldType, string> = {
  text: 'Single line of plain text, up to 1000 characters.',
  textarea:
    'Plain text, several lines allowed, up to 50000 characters. No Markdown.',
  richtext:
    'Markdown string. Section headings start with ## (### and #### for subsections; other levels are clamped), paragraphs separated by a blank line, **bold**, *italic*, [links](https://...), bullet and numbered lists, > blockquotes, tables, and images as ![alt text](asset:<assetId>). Raw HTML is dropped. Images from a full https URL also work but prefer uploaded assets. ' +
    CODE_FORMAT,
  image:
    'Asset id string from list_assets, upload_asset_from_url or get_asset_upload. Alt text comes from the asset (set it with update_asset_alt).',
  date: 'Calendar date as YYYY-MM-DD, e.g. 2026-10-10. Content only: a date field does not schedule the entry.',
  datetime:
    'ISO 8601 date and time with an offset, e.g. 2026-10-10T09:00:00+02:00 or 2026-10-10T07:00:00Z. Content only: it does not schedule the entry.',
  select: 'One of the listed options, spelled exactly.',
  reference:
    'Entry id of an entry in the referenced collection. Find ids with list_entries.',
  slug: 'Lowercase letters, numbers and dashes only, e.g. my-first-post. Unique within the collection.',
  boolean: 'true or false.',
  number: 'A JSON number, e.g. 3 or 4.5.',
  url: 'Absolute http or https URL, e.g. https://example.com/page.',
}

export function describeField(
  field: Field,
  /** Only on sites with languages: whether the field is stored per language. */
  options: { translatable?: boolean } = {},
): {
  key: string
  label: string
  type: FieldType
  required: boolean
  format: string
  translatable?: boolean
  options?: string[]
  referencesCollection?: string
  description?: string
  mustBeOnOrAfter?: string
} {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required === true,
    format: formatFor(field),
    ...(options.translatable !== undefined
      ? { translatable: options.translatable }
      : {}),
    ...(field.options?.length ? { options: field.options } : {}),
    ...(field.type === 'reference' && field.collection
      ? { referencesCollection: field.collection }
      : {}),
    ...(field.description ? { description: field.description } : {}),
    ...(field.after ? { mustBeOnOrAfter: field.after } : {}),
  }
}

function formatFor(field: Field): string {
  if (field.type === 'select' && field.options?.length) {
    return `One of: ${field.options.join(', ')}.`
  }
  if (field.type === 'reference') {
    return field.collection
      ? `Entry id of a "${field.collection}" entry. Find ids with list_entries({collection:"${field.collection}"}).`
      : TYPE_FORMAT.reference
  }
  return TYPE_FORMAT[field.type]
}

const EXAMPLE_MARKDOWN = [
  'Short intro that answers the reader’s question in the first sentence.',
  '',
  '## The main idea',
  '',
  'A paragraph with **bold** text, `inline code` and a [link](https://example.com).',
  '',
  '- First point',
  '- Second point',
  '',
  '```ts',
  "const greeting = 'hello'",
  '```',
  '',
  '![Describe what the image shows](asset:<assetId>)',
  '',
  '## Next steps',
  '',
  'Closing paragraph.',
].join('\n')

/** Sample value for one field. Placeholders in angle brackets must be replaced. */
export function exampleValue(field: Field): unknown {
  switch (field.type) {
    case 'text':
      return `${field.label} for this entry`
    case 'textarea':
      return 'Two or three sentences that summarise the entry.'
    case 'richtext':
      return EXAMPLE_MARKDOWN
    case 'image':
      return '<assetId from list_assets>'
    case 'date':
      return '2026-10-10'
    case 'datetime':
      return '2026-10-10T09:00:00+02:00'
    case 'select':
      return field.options?.[0] ?? 'value'
    case 'reference':
      return `<entryId from list_entries${field.collection ? ` of "${field.collection}"` : ''}>`
    case 'slug':
      return 'my-first-entry'
    case 'boolean':
      return false
    case 'number':
      return 0
    case 'url':
      return 'https://example.com/page'
  }
}

export function exampleFields(fields: Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    out[field.key] = exampleValue(field)
  }
  return out
}

export const EXAMPLE_SEO = {
  title: 'Sourdough starter basics | Bakery Notes',
  description:
    'How to feed, store and troubleshoot a sourdough starter, step by step, for home bakers.',
  focusKeyphrase: 'sourdough starter',
  summary:
    'A sourdough starter is a living mix of flour and water. Feed it daily with equal weights of flour and water.',
  keyTakeaways: [
    'Feed the starter at a fixed time each day.',
    'Keep it warm for faster rises.',
  ],
  faq: [
    {
      question: 'How often should I feed a starter?',
      answer: 'Once a day at room temperature, or weekly in the fridge.',
    },
  ],
  schemaType: 'BlogPosting',
}

/**
 * How an entry's status reads. The UI calls the stored 'published' state "Ready".
 * Used in get_site_info and the instructions, so the words match the CMS.
 */
export const STATUS_GUIDE = [
  'Entry status: draft (being written, not approved), ready (approved for the next release), scheduled (goes live at a set time), archived (retired).',
  'live: true means the entry is on the live site now. pendingRelease: true means approved changes are waiting for the next go live.',
  'A ready entry can still have live: false until the next go live.',
].join(' ')

/** Date and datetime fields are content, not scheduling. */
export const DATES_NOTE =
  'Date and datetime fields are content you write (for example an event date). They do not publish or schedule the entry. To schedule an entry to go live, use schedule_entry.'

export const SEO_GUIDE = [
  'Write SEO for every entry: title (about 50-60 characters), description (140-160 characters), focusKeyphrase, summary (2-3 sentences), 3-5 keyTakeaways, and faq only when the body answers real questions.',
  'Set ogImage to an uploaded asset id when there is a suitable image.',
].join(' ')

/**
 * Multi-language sites: how to write one language, as a copyable call. The
 * example uses the first non-main language and only its translatable fields.
 */
export function translationExample(input: {
  main: string
  all: string[]
  fields: Field[]
  seoEnabled: boolean
  tool: 'update_entry' | 'update_global'
  target: Record<string, string>
}): {
  note: string
  example: { tool: string; arguments: Record<string, unknown> }
} {
  const other = input.all.find((code) => code !== input.main) ?? input.main
  const translatable = input.fields.filter(isTranslatable)
  return {
    note: `Write one language per call: pass locale ("${other}" in the example). Translatable fields and seo are stored per language; other fields are shared, so changing them in one language changes every language.`,
    example: {
      tool: input.tool,
      arguments: {
        ...input.target,
        locale: other,
        fields: exampleFields(translatable),
        ...(input.seoEnabled ? { seo: EXAMPLE_SEO } : {}),
      },
    },
  }
}
