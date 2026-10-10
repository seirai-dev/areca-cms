import { chat } from '@tanstack/ai'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import sharp from 'sharp'

import { getStorage } from '#/adapters'
import type { Asset } from '#/server/assets'
import { assetUrl, loadAssetLookup } from '#/server/assets'
import { richTextAssetRefs } from '#/server/assets/richtext-ownership'
import { env } from '#/env'
import { aiSeoSuggestionSchema } from '#/lib/ai-seo'
import type { AiSeoSuggestion } from '#/lib/ai-seo'
import { entryTitle } from '#/lib/content/utils'
import { SEO_LIMITS, entryPublicUrl, readEntrySeo } from '#/lib/seo'
import type { EntryData, Field } from '#/lib/types'
import { AppError } from '#/server/http/app-error'
import { serializeMarkdown } from '#/server/richtext/markdown'

import { findOpenRouterModel } from './openrouter.ts'
import type { AiRuntimeConfig } from './settings.ts'

const MAX_IMAGES = 4
const IMAGE_MAX_EDGE = 1024
const BODY_MAX_CHARS = 40_000
const FIELD_MAX_CHARS = 4_000
const TIMEOUT_MS = 120_000

type OpenRouterModelId = Parameters<typeof createOpenRouterText>[0]

export type AiImageInput = {
  id: string
  url: string
  filename: string
  alt: string | null
}

/** User-facing AI failure (message is safe to show). */
export class AiGenerationError extends AppError {
  readonly status: number = 502
  constructor(
    message: string,
    readonly code:
      | 'timeout'
      | 'provider'
      | 'invalid_output'
      | 'truncated'
      | 'not_configured'
      | 'rate_limited',
  ) {
    super(message)
    this.name = 'AiGenerationError'
    if (code === 'not_configured') this.status = 409
    if (code === 'rate_limited') this.status = 429
  }
}

const clip = (value: string, max: number) => {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function fieldText(field: Field, value: unknown): string | null {
  if (value == null || value === '') return null
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'select':
    case 'url':
    case 'date':
    case 'datetime':
      return typeof value === 'string' ? clip(value, FIELD_MAX_CHARS) : null
    case 'number':
    case 'boolean':
      return String(value)
    default:
      return null
  }
}

/** Images worth showing the model: image fields, OG image, then inline. */
async function collectImages(
  organizationId: string,
  fields: Field[],
  data: EntryData,
): Promise<Asset[]> {
  const ids: string[] = []
  const keys: string[] = []
  for (const field of fields) {
    const value = data[field.key]
    if (field.type === 'image' && typeof value === 'string' && value)
      ids.push(value)
  }
  const ogImage = readEntrySeo(data).ogImage
  if (ogImage) ids.push(ogImage)
  for (const field of fields) {
    if (field.type === 'richtext')
      keys.push(...richTextAssetRefs(data[field.key]).storageKeys)
  }
  // The lookup is scoped to the organization, so foreign ids drop out here.
  const lookup = await loadAssetLookup(organizationId, {
    ids,
    storageKeys: keys,
  })
  const ordered: Asset[] = []
  const seen = new Set<string>()
  const push = (row: Asset | undefined) => {
    if (!row || seen.has(row.id) || !row.mimeType.startsWith('image/')) return
    seen.add(row.id)
    ordered.push(row)
  }
  for (const id of ids) push(lookup.byId.get(id))
  for (const key of keys) push(lookup.byStorageKey.get(key))
  return ordered.slice(0, MAX_IMAGES)
}

async function readImageBase64(row: Asset): Promise<string | null> {
  try {
    const object = await getStorage().get(row.storageKey)
    if (!object) return null
    const buffer = Buffer.isBuffer(object.body)
      ? object.body
      : Buffer.from(await new Response(object.body).arrayBuffer())
    const resized = await sharp(buffer, { animated: false })
      .rotate()
      .resize(IMAGE_MAX_EDGE, IMAGE_MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer()
    return resized.toString('base64')
  } catch {
    return null
  }
}

export function buildArticlePrompt(input: {
  site: { name: string; productionUrl: string }
  collectionLabel: string
  routePattern: string
  fields: Field[]
  data: EntryData
  slug: string
  images: AiImageInput[]
}): string {
  const { fields, data } = input
  const lines: string[] = []
  lines.push(`Website: ${input.site.name} (${input.site.productionUrl})`)
  lines.push(`Content type: ${input.collectionLabel}`)
  const url = entryPublicUrl(
    input.site.productionUrl,
    input.routePattern,
    input.slug,
  )
  if (url) lines.push(`Page URL: ${url}`)
  lines.push(`Title: ${entryTitle(data, fields, input.slug)}`)

  const titleKey = fields.find((field) => field.type === 'text')?.key
  const other = fields
    .filter((field) => field.key !== titleKey && field.type !== 'richtext')
    .map((field) => [field.label, fieldText(field, data[field.key])] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]))
  if (other.length) {
    lines.push('', '## Fields')
    for (const [label, value] of other) lines.push(`${label}: ${value}`)
  }

  let budget = BODY_MAX_CHARS
  for (const field of fields) {
    if (field.type !== 'richtext' || budget <= 0) continue
    let markdown = ''
    try {
      markdown = serializeMarkdown(data[field.key]).trim()
    } catch {
      markdown = ''
    }
    if (!markdown) continue
    const body = clip(markdown, budget)
    budget -= body.length
    lines.push('', `## ${field.label}`, body)
  }

  if (input.images.length) {
    lines.push('', '## Images (attached in this order when supported)')
    for (const image of input.images) {
      lines.push(
        `- id=${image.id} file="${image.filename}" alt=${
          image.alt ? JSON.stringify(image.alt) : 'MISSING ALT'
        }`,
      )
    }
  }

  const seo = readEntrySeo(data)
  const current = Object.entries({
    title: seo.title,
    description: seo.description,
    focusKeyphrase: seo.focusKeyphrase,
    summary: seo.summary,
  }).filter(([, value]) => typeof value === 'string' && value.trim())
  if (current.length) {
    lines.push('', '## Current SEO values (improve on them)')
    for (const [key, value] of current) lines.push(`${key}: ${value}`)
  }

  return lines.join('\n')
}

/** Clamp to stored limits and drop anything the editor cannot apply. */
export function normalizeSuggestion(
  raw: AiSeoSuggestion,
  images: AiImageInput[],
): AiSeoSuggestion {
  const text = (value: string, max: number) => value.trim().slice(0, max)
  const missingAlt = new Set(
    images.filter((image) => !image.alt).map((image) => image.id),
  )
  const isUrl = (value: string) => {
    try {
      const parsed = new URL(value)
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    } catch {
      return false
    }
  }
  return {
    title: text(raw.title, SEO_LIMITS.title),
    description: text(raw.description, SEO_LIMITS.description),
    focusKeyphrase: text(raw.focusKeyphrase, SEO_LIMITS.keyphrase),
    ogTitle: text(raw.ogTitle, SEO_LIMITS.title),
    ogDescription: text(raw.ogDescription, SEO_LIMITS.description),
    schemaType: raw.schemaType,
    about: raw.about
      .map((item) => ({
        name: text(item.name, SEO_LIMITS.aboutName),
        sameAs: isUrl(item.sameAs.trim()) ? item.sameAs.trim() : '',
      }))
      .filter((item) => item.name)
      .slice(0, 5),
    summary: text(raw.summary, SEO_LIMITS.summary),
    keyTakeaways: raw.keyTakeaways
      .map((item) => text(item, SEO_LIMITS.takeaway))
      .filter(Boolean)
      .slice(0, SEO_LIMITS.takeaways),
    faq: raw.faq
      .map((item) => ({
        question: text(item.question, SEO_LIMITS.faqQuestion),
        answer: text(item.answer, SEO_LIMITS.faqAnswer),
      }))
      .filter((item) => item.question && item.answer)
      .slice(0, 8),
    imageAlts: raw.imageAlts
      .filter((item) => missingAlt.has(item.imageId))
      .map((item) => ({ imageId: item.imageId, alt: text(item.alt, 1_000) }))
      .filter((item) => item.alt),
  }
}

export type GenerateSeoResult = {
  suggestion: AiSeoSuggestion
  images: AiImageInput[]
  model: string
  usedImages: boolean
  warnings: string[]
  usage: { promptTokens?: number; completionTokens?: number; cost?: number }
}

export async function generateSeoSuggestion(input: {
  config: AiRuntimeConfig
  sitePrompt: string | null
  site: { name: string; productionUrl: string; organizationId: string }
  collectionLabel: string
  routePattern: string
  fields: Field[]
  data: EntryData
  slug: string
}): Promise<GenerateSeoResult> {
  const assets = await collectImages(
    input.site.organizationId,
    input.fields,
    input.data,
  )
  let images: AiImageInput[] = assets.map((row) => ({
    id: row.id,
    url: assetUrl(row),
    filename: row.originalFilename,
    alt: row.altText?.trim() || null,
  }))

  const model = await findOpenRouterModel(input.config.model)
  const imageParts: {
    type: 'image'
    source: { type: 'data'; value: string; mimeType: string }
  }[] = []
  const warnings: string[] = []
  if (model?.supportsImages) {
    const readableIds = new Set<string>()
    for (const row of assets) {
      const value = await readImageBase64(row)
      if (value) {
        readableIds.add(row.id)
        imageParts.push({
          type: 'image',
          source: { type: 'data', value, mimeType: 'image/jpeg' },
        })
      } else {
        warnings.push(
          `Skipped unreadable image: ${row.originalFilename}. Its image description was not generated.`,
        )
      }
    }
    images = images.filter((image) => readableIds.has(image.id))
  }

  const article = buildArticlePrompt({
    site: input.site,
    collectionLabel: input.collectionLabel,
    routePattern: input.routePattern,
    fields: input.fields,
    data: input.data,
    slug: input.slug,
    images,
  })

  const adapter = createOpenRouterText(
    input.config.model as OpenRouterModelId,
    input.config.apiKey,
    { httpReferer: env.APP_URL, appTitle: 'Areca CMS' },
  )
  const usage: GenerateSeoResult['usage'] = {}
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), TIMEOUT_MS)
  try {
    const raw = await chat({
      adapter,
      systemPrompts: [
        input.config.systemPrompt,
        ...(input.sitePrompt?.trim()
          ? [
              `Site-specific instructions for ${input.site.name}:\n${input.sitePrompt.trim()}`,
            ]
          : []),
      ],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', content: article }, ...imageParts],
        },
      ],
      outputSchema: aiSeoSuggestionSchema,
      modelOptions: { temperature: 0.3, maxCompletionTokens: 6_000 },
      abortController,
      debug: false,
      middleware: [
        {
          name: 'areca-usage',
          onUsage: (_ctx, info) => {
            usage.promptTokens = (usage.promptTokens ?? 0) + info.promptTokens
            usage.completionTokens =
              (usage.completionTokens ?? 0) + info.completionTokens
            if (typeof info.cost === 'number')
              usage.cost = (usage.cost ?? 0) + info.cost
          },
        },
      ],
    })
    return {
      suggestion: normalizeSuggestion(raw, images),
      images,
      model: input.config.model,
      usedImages: imageParts.length > 0,
      warnings,
      usage,
    }
  } catch (error) {
    throw toGenerationError(error, abortController.signal.aborted)
  } finally {
    clearTimeout(timer)
  }
}

function toGenerationError(error: unknown, aborted: boolean) {
  if (aborted)
    return new AiGenerationError(
      'The AI model took too long to respond',
      'timeout',
    )
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: unknown } | null)?.code
  if (
    code === 'structured-output-validation-failed' ||
    code === 'structured-output-missing-result' ||
    /parse structured output/i.test(message)
  ) {
    return new AiGenerationError(
      'The AI model returned an answer in the wrong format. Try again or pick another model.',
      'invalid_output',
    )
  }
  if (/finish_reason=length/i.test(message)) {
    return new AiGenerationError(
      'The AI answer was cut off. Try again or pick a model with a larger output limit.',
      'truncated',
    )
  }
  // Provider messages can be long; never echo request content.
  return new AiGenerationError(
    `The AI provider returned an error: ${message.slice(0, 300)}`,
    'provider',
  )
}
