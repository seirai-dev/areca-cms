import { entryTitle } from '#/lib/content/utils'
import { entryPublicUrl, readEntrySeo, resolveEntrySeo } from '#/lib/seo'
import type { EntryData, Field, ImageValue, SeoMeta } from '#/lib/types'
import { richTextPlainText } from '#/server/richtext'

function isImageValue(value: unknown): value is ImageValue {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as ImageValue).url === 'string'
  )
}

/** Plain-text description source: first textarea, else first rich text. */
export function fallbackDescription(
  fields: Field[],
  data: EntryData,
): string | null {
  for (const field of fields) {
    const value = data[field.key]
    if (field.type === 'textarea' && typeof value === 'string' && value.trim())
      return value
  }
  for (const field of fields) {
    if (field.type !== 'richtext') continue
    const text = richTextPlainText(data[field.key])
    if (text) return text
  }
  return null
}

/**
 * A datetime/date field that reads like a publish date ("Published at"),
 * which editors often keep as the article's public date.
 */
function publishDateField(fields: Field[], data: EntryData): string | null {
  for (const field of fields) {
    if (field.type !== 'datetime' && field.type !== 'date') continue
    if (!/publish/i.test(`${field.key} ${field.label}`)) continue
    const value = data[field.key]
    if (typeof value === 'string' && value && !Number.isNaN(Date.parse(value)))
      return value
  }
  return null
}

/**
 * Resolved `entry.seo` for a snapshot or preview entry. `data` is the stored
 * entry data (asset ids, TipTap JSON); `converted` holds resolved images.
 */
export function buildEntrySeo(input: {
  fields: Field[]
  data: EntryData
  converted: Record<string, unknown>
  slug: string
  routePattern: string
  site: { name: string; productionUrl: string }
  ogImage: ImageValue | null
  publishedAt: Date | null
}): SeoMeta {
  const heroField = input.fields.find(
    (field) =>
      field.type === 'image' && isImageValue(input.converted[field.key]),
  )
  const publishedAt = input.publishedAt?.toISOString() ?? null
  return resolveEntrySeo({
    seo: readEntrySeo(input.data),
    title: entryTitle(input.data, input.fields, input.slug),
    fallbackDescription: fallbackDescription(input.fields, input.data),
    url: entryPublicUrl(
      input.site.productionUrl,
      input.routePattern,
      input.slug,
    ),
    site: { name: input.site.name, url: input.site.productionUrl },
    ogImage: input.ogImage,
    heroImage: heroField
      ? (input.converted[heroField.key] as ImageValue)
      : null,
    datePublished: publishDateField(input.fields, input.data) ?? publishedAt,
    dateModified: publishedAt,
  })
}
