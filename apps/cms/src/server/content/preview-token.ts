import { createHmac, timingSafeEqual } from 'node:crypto'

/** A token previews one entry (`collection` + `slug`) or one site content section (`global`). */
export type PreviewTokenPayload = {
  siteId: string
  exp: number
  /** Language to preview. Absent = main language. The preview URL may override it. */
  locale?: string
} & (
  | { global?: undefined; collection: string; slug: string }
  | { global: string; collection?: undefined; slug?: undefined }
)

type PreviewTokenInput = {
  siteId: string
  secret: string
  ttlSec?: number
  /** Entry preview: collection key and slug. */
  collection?: string
  slug?: string
  /** Site content section preview: raw section key. Takes precedence. */
  global?: string
  /** Language to preview (BCP 47). Omitted from the token when unset. */
  locale?: string
}

export function signPreviewToken(input: PreviewTokenInput): string {
  const ttlSec = input.ttlSec ?? 3600
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  let payload: PreviewTokenPayload
  if (input.global !== undefined) {
    payload = { siteId: input.siteId, global: input.global, exp }
  } else if (input.collection !== undefined && input.slug !== undefined) {
    payload = {
      siteId: input.siteId,
      collection: input.collection,
      slug: input.slug,
      exp,
    }
  } else {
    throw new Error(
      'A preview token needs a site content key or a collection and slug',
    )
  }
  if (input.locale !== undefined) payload.locale = input.locale
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  )
  const sig = createHmac('sha256', input.secret)
    .update(payloadB64)
    .digest('base64url')
  return `${payloadB64}.${sig}`
}

export function verifyPreviewToken(
  token: string,
  secret: string,
): PreviewTokenPayload | null {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)

  const expected = createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url')
  if (!safeEqual(sig, expected)) return null

  const payload = parsePayload(payloadB64)
  if (!payload) return null
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

export function decodePreviewToken(token: string): PreviewTokenPayload | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  return parsePayload(token.slice(0, dot))
}

/** Shape check for a decoded payload. Unknown shapes are not tokens. */
function parsePayload(payloadB64: string): PreviewTokenPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as Partial<
      Record<'siteId' | 'collection' | 'slug' | 'global' | 'exp' | 'locale', unknown>
    >
    if (typeof parsed.siteId !== 'string' || typeof parsed.exp !== 'number') {
      return null
    }
    const locale =
      typeof parsed.locale === 'string' && parsed.locale !== ''
        ? { locale: parsed.locale }
        : {}
    if (typeof parsed.global === 'string') {
      return {
        siteId: parsed.siteId,
        global: parsed.global,
        exp: parsed.exp,
        ...locale,
      }
    }
    if (
      typeof parsed.collection !== 'string' ||
      typeof parsed.slug !== 'string'
    ) {
      return null
    }
    return {
      siteId: parsed.siteId,
      collection: parsed.collection,
      slug: parsed.slug,
      exp: parsed.exp,
      ...locale,
    }
  } catch {
    return null
  }
}

export function buildPreviewUrl(
  productionUrl: string,
  collection: string,
  slug: string,
  token: string,
  locale?: string | null,
) {
  const base = productionUrl.replace(/\/+$/, '')
  return `${base}/__preview/${collection}/${slug}?token=${encodeURIComponent(token)}${localeParam(locale)}`
}

function localeParam(locale: string | null | undefined) {
  return locale ? `&locale=${encodeURIComponent(locale)}` : ''
}

/**
 * Preview URL for a site content section: the site's own page at `previewPath`
 * with the token in `arecaPreview`, so the site can render the draft in place.
 */
export function buildGlobalPreviewUrl(
  productionUrl: string,
  previewPath: string,
  token: string,
  locale?: string | null,
) {
  const base = productionUrl.replace(/\/+$/, '')
  return `${base}${previewPath}?arecaPreview=${encodeURIComponent(token)}${localeParam(locale)}`
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
