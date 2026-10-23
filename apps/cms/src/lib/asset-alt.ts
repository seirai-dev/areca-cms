/**
 * Whether a Library image is missing its description (alt text) in one
 * content language. The main language reads `altText`; every other language
 * reads only its own `altI18n` entry, so the main alt is not a fallback and a
 * value that exists only through fallback counts as missing. Blank counts as
 * missing. Mirrors `missingAltFilter` in `#/server/assets/missing-alt`.
 */
export function isAltMissing(
  asset: {
    mimeType: string
    altText?: string | null
    altI18n?: Record<string, string> | null
  },
  locale: string | null,
  mainLocale: string | null,
): boolean {
  if (!asset.mimeType.startsWith('image/')) return false
  const value =
    locale === null || locale === mainLocale
      ? asset.altText
      : asset.altI18n?.[locale]
  return !value?.trim()
}
