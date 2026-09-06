import { createHmac, timingSafeEqual } from 'node:crypto'

export type PreviewTokenPayload = {
  siteId: string
  collection: string
  slug: string
  exp: number
}

export function signPreviewToken(input: {
  siteId: string
  collection: string
  slug: string
  secret: string
  ttlSec?: number
}): string {
  const ttlSec = input.ttlSec ?? 3600
  const payload: PreviewTokenPayload = {
    siteId: input.siteId,
    collection: input.collection,
    slug: input.slug,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  }
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

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as Partial<PreviewTokenPayload>
    if (
      typeof parsed.siteId !== 'string' ||
      typeof parsed.collection !== 'string' ||
      typeof parsed.slug !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null
    return {
      siteId: parsed.siteId,
      collection: parsed.collection,
      slug: parsed.slug,
      exp: parsed.exp,
    }
  } catch {
    return null
  }
}

export function decodePreviewToken(
  token: string,
): PreviewTokenPayload | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(token.slice(0, dot), 'base64url').toString('utf8'),
    ) as Partial<PreviewTokenPayload>
    if (
      typeof parsed.siteId !== 'string' ||
      typeof parsed.collection !== 'string' ||
      typeof parsed.slug !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null
    }
    return {
      siteId: parsed.siteId,
      collection: parsed.collection,
      slug: parsed.slug,
      exp: parsed.exp,
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
) {
  const base = productionUrl.replace(/\/+$/, '')
  return `${base}/__preview/${collection}/${slug}?token=${encodeURIComponent(token)}`
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
