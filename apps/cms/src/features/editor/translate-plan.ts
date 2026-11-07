/**
 * Pure helpers for AI translation in the multilingual editors. No React and no
 * server code, so they are unit tested. The server (`translateContentFn`)
 * does the model call; these decide which fields to send and how the answer
 * lands in the target language. See docs/design/content-languages.md (AI).
 */
import { isTranslatable } from '#/lib/content-locale'
import { isEmptyRichText } from '#/lib/rich-text-empty'
import { SEO_KEY } from '#/lib/seo'
import type { EntrySeo } from '#/lib/seo'
import type { EntryData, Field } from '#/lib/types'

/** `$seo` text values the translation covers. Lists (takeaways, FAQ) are not sent. */
export const SEO_TRANSLATE_KEYS = [
  'title',
  'description',
  'focusKeyphrase',
  'ogTitle',
  'ogDescription',
  'summary',
] as const

/** Field types the server translates. Other translatable types (a URL) are not sent. */
export function canTranslateField(field: Field): boolean {
  return (
    (field.type === 'text' ||
      field.type === 'textarea' ||
      field.type === 'richtext') &&
    isTranslatable(field)
  )
}

/** Empty for translation: blank text, or a rich text document with no text. */
export function isBlankValue(type: string, value: unknown): boolean {
  if (type === 'richtext') return value == null || isEmptyRichText(value)
  return typeof value !== 'string' || value.trim() === ''
}

function seoOf(data: EntryData): Record<string, unknown> {
  const value = data[SEO_KEY]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Keys that are empty in the target language: translatable text fields and
 * `$seo` text values. Keys are field keys, or `seo.<name>`. `target` and
 * `source` are flat views of one language each (`readLocale`).
 */
export function emptyTargetKeys(input: {
  fields: Field[]
  target: EntryData
  seoEnabled: boolean
}): string[] {
  const keys: string[] = []
  for (const field of input.fields) {
    if (!canTranslateField(field)) continue
    if (isBlankValue(field.type, input.target[field.key])) keys.push(field.key)
  }
  if (input.seoEnabled) {
    const seo = seoOf(input.target)
    for (const name of SEO_TRANSLATE_KEYS) {
      if (isBlankValue('text', seo[name])) keys.push(`seo.${name}`)
    }
  }
  return keys
}

/**
 * Keys that have text in the source (main) language: translatable text fields
 * and `$seo` text values that are filled. With none, there is nothing to
 * translate from, and the language action is disabled.
 */
export function translatableSourceKeys(input: {
  fields: Field[]
  source: EntryData
  seoEnabled: boolean
}): string[] {
  const keys: string[] = []
  for (const field of input.fields) {
    if (!canTranslateField(field)) continue
    if (!isBlankValue(field.type, input.source[field.key])) keys.push(field.key)
  }
  if (input.seoEnabled) {
    const seo = seoOf(input.source)
    for (const name of SEO_TRANSLATE_KEYS) {
      if (!isBlankValue('text', seo[name])) keys.push(`seo.${name}`)
    }
  }
  return keys
}

/**
 * The keys to send for "Translate from <main>": empty in the target AND filled
 * in the source. Nothing else is sent, so the server never overwrites text.
 */
export function fieldsToTranslate(input: {
  fields: Field[]
  source: EntryData
  target: EntryData
  seoEnabled: boolean
}): string[] {
  const sourceKeys = new Set(translatableSourceKeys(input))
  return emptyTargetKeys(input).filter((key) => sourceKeys.has(key))
}

/** Outcome of the editor's save (`editor.save`, the same path as Cmd/Ctrl+S). */
export type SaveOutcome = 'saved' | 'failed' | 'blocked'

/**
 * Saves first, then runs `then` only when the save succeeded. Returns the
 * outcome, so the caller can show the save error and stop.
 */
export async function afterSave(
  save: () => Promise<SaveOutcome>,
  then: () => void,
): Promise<SaveOutcome> {
  const outcome = await save()
  if (outcome === 'saved') then()
  return outcome
}

/** The result shape of `translateContentFn`. */
export type TranslateResult = {
  values: Record<string, unknown>
  seo?: Partial<EntrySeo>
  /** Things the translation dropped, such as a link to an entry the model invented. */
  warnings?: string[]
}

/**
 * What to write into the target language for a translation result: the field
 * values, and `$seo` merged over the target's existing SEO. `applied` lists the
 * keys written, as `seo.<name>` for SEO values. The caller writes `patch` with
 * `updateLocaleFields`, which goes through `writeLocale` like any edit.
 */
export function translationPatch(
  target: EntryData,
  result: TranslateResult,
): { patch: EntryData; applied: string[] } {
  const patch: EntryData = { ...result.values }
  const seoEntries = Object.entries(result.seo ?? {})
  if (seoEntries.length > 0) {
    patch[SEO_KEY] = { ...seoOf(target), ...Object.fromEntries(seoEntries) }
  }
  return {
    patch,
    applied: [
      ...Object.keys(result.values),
      ...seoEntries.map(([name]) => `seo.${name}`),
    ],
  }
}

/** The `data-field` attribute a translated key is rendered under. */
export function fieldAttributeFor(key: string): string {
  return key.startsWith('seo.') ? `${SEO_KEY}.${key.slice('seo.'.length)}` : key
}
