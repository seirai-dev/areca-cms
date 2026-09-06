import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { site } from '#/db/schema'
import { audit } from '#/server/audit'

import { NotFoundError } from './errors.ts'

export function generateSiteToken() {
  const token = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(token).digest('hex')
  return { token, hash }
}

export async function authenticateSite(request: Request) {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null
  const hash = createHash('sha256').update(token).digest('hex')
  const [found] = await db
    .select()
    .from(site)
    .where(eq(site.tokenHash, hash))
    .limit(1)
  return found ?? null
}

export async function rotateSiteToken(siteId: string) {
  const [existing] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!existing) {
    throw new NotFoundError('Site not found')
  }

  const generated = generateSiteToken()
  await db
    .update(site)
    .set({ tokenHash: generated.hash, updatedAt: new Date() })
    .where(eq(site.id, siteId))

  await audit({
    organizationId: existing.organizationId,
    siteId,
    action: 'site.rotate_token',
    targetType: 'site',
    targetId: siteId,
  })

  return generated
}
