import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { eq } from 'drizzle-orm'

import { symmetricEncrypt } from 'better-auth/crypto'

import { db, pool } from '#/db'
import { account, entry, invitation, site, twoFactor, user } from '#/db/schema'
import type { Field, SiteLanguages } from '#/lib/types'
import { SEO_KEY } from '#/lib/seo'
import { auth } from '#/lib/auth'
import { env } from '#/env'
import { createOrganization } from '#/server/admin/organizations'
import { acceptInvitation } from '#/server/admin/invitations'
import { setSiteLanguages } from '#/server/admin/site-languages'
import { createSite } from '#/server/admin/sites'
import { upsertCollection } from '#/server/content/collections'
import {
  createEntry,
  getEntry,
  publishEntry,
  scheduleEntry,
  updateDraft,
} from '#/server/content/entries'
import { getGlobalEntry, upsertGlobal } from '#/server/content/globals'
import { uploadAsset, loadAssetLookup } from '#/server/assets'
import {
  collectAssetIds,
  mergeSeo,
  seoPatchFromInput,
  toStoredFields,
} from '#/server/mcp/entry-format'
import { applyLocaleWrite } from '#/server/mcp/locales'
import { hashToken } from '#/server/security/token-hash'
import { requestPublication } from '#/server/publishing/publications'
import { processJob } from '#/server/publishing/job-run'

import { assertLocalDevDatabase } from './lib/local-db-guard'
import { harborAndPine } from './demo-data/harbor-and-pine'
import { northwindCycling } from './demo-data/northwind-cycling'
import { lumenDental } from './demo-data/lumen-dental'
import { fieldnoteArchitects } from './demo-data/fieldnote-architects'
import { kestrelOutdoor } from './demo-data/kestrel-outdoor'
import type { DemoClient, DemoEntry } from './demo-data/types'

/**
 * Deterministic demo content for local development. `pnpm db:demo` runs the
 * reset first, so this always starts from an empty database. All copy and
 * image choices are in ./demo-data; nothing is generated.
 */

const ADMIN_EMAIL = 'admin@areca.local'
const PASSWORD = 'password123'
/**
 * Fixed authenticator secret for the agency admin, so the demo can be signed
 * into without a phone. Base32 form (what an authenticator app asks for):
 * MFZGKY3BFVSGK3LPFV2G65DQFVZWKY3SMV2A. Better Auth's TOTP key is the UTF-8
 * bytes of the plaintext below, so the stored value is that plaintext, encrypted
 * with BETTER_AUTH_SECRET exactly as the two-factor plugin does it. Documented in
 * docs/DEVELOPMENT.md (Demo data). Owners and editors have no two-factor.
 */
const ADMIN_TOTP_SECRET = 'areca-demo-totp-secret'
const CLIENTS: DemoClient[] = [
  harborAndPine,
  northwindCycling,
  lumenDental,
  fieldnoteArchitects,
  kestrelOutdoor,
]

const IMAGE_CACHE = fileURLToPath(
  new URL('../.cache/demo-images/', import.meta.url),
)

type Ctx = {
  orgId: string
  siteId: string
  actorId: string
  assets: Map<string, string>
  entryIds: Map<string, string>
  fieldsByCollection: Map<string, Field[]>
  languages: SiteLanguages | null
}

function picsumUrl(id: number) {
  return `https://picsum.photos/id/${id}/1600/1000.jpg`
}

/** Downloads once, then reads the cached file, so reseeding works offline. */
async function loadPicsum(id: number): Promise<Buffer> {
  const file = join(IMAGE_CACHE, `picsum-${id}-1600x1000.jpg`)
  if (existsSync(file)) return readFile(file)
  const response = await fetch(picsumUrl(id))
  if (!response.ok) {
    throw new Error(`Could not download ${picsumUrl(id)}: ${response.status}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await mkdir(IMAGE_CACHE, { recursive: true })
  await writeFile(file, buffer)
  return buffer
}

async function signUp(name: string, email: string, invitationToken: string) {
  // Same shape as scripts/seed.ts: the invitation token rides along in the body.
  const body = { name, email, password: PASSWORD, invitationToken }
  const result = await auth.api.signUpEmail({ body })
  return result.user
}

/** Same door a real person uses: invitation, sign-up, then accept. */
async function inviteAndSignUp(input: {
  name: string
  email: string
  organizationId: string
  role: 'owner' | 'editor'
}) {
  const token = randomBytes(32).toString('hex')
  await db.insert(invitation).values({
    email: input.email,
    organizationId: input.organizationId,
    role: input.role,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  })
  const created = await signUp(input.name, input.email, token)
  await acceptInvitation({ token, userId: created.id })
  return created
}

async function createAdmin() {
  const id = crypto.randomUUID()
  const context = await auth.$context
  // Same encryption the two-factor plugin applies (see better-auth/plugins/two-factor).
  const encryptedSecret = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: ADMIN_TOTP_SECRET,
  })
  const encryptedBackupCodes = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: '[]',
  })
  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id,
      name: 'Alex Morgan',
      email: ADMIN_EMAIL,
      isAgencyAdmin: true,
      twoFactorEnabled: true,
    })
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      userId: id,
      providerId: 'credential',
      accountId: id,
      password: await context.password.hash(PASSWORD),
    })
    await tx.insert(twoFactor).values({
      id: crypto.randomUUID(),
      userId: id,
      secret: encryptedSecret,
      backupCodes: encryptedBackupCodes,
      verified: true,
    })
  })
  return id
}

/** Resolves image keys and references in one field value. */
function resolveValue(field: Field, value: unknown, ctx: Ctx): unknown {
  if (typeof value !== 'string') return value
  if (field.type === 'image' && value.startsWith('img:')) {
    return assetId(ctx, value.slice(4))
  }
  if (field.type === 'reference' && value.startsWith('ref:')) {
    const [, collectionKey, slug] = value.split(':')
    const id = ctx.entryIds.get(`${collectionKey}:${slug}`)
    if (!id) throw new Error(`Missing reference target ${value}`)
    return { entryId: id }
  }
  if (field.type === 'richtext') {
    return value.replace(/\(img:(\w+)\)/g, (_match, key: string) => {
      return `(asset:${assetId(ctx, key)})`
    })
  }
  return value
}

function assetId(ctx: Ctx, key: string) {
  const id = ctx.assets.get(key)
  if (!id) throw new Error(`Unknown image key "${key}"`)
  return id
}

/** Turns demo input into the stored shape the server expects (what MCP tools do). */
async function storeFields(
  ctx: Ctx,
  fields: Field[],
  input: Record<string, unknown>,
  seo?: Record<string, unknown>,
) {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const field = fields.find((item) => item.key === key)
    if (!field) throw new Error(`Field "${key}" is not in the collection`)
    resolved[key] = resolveValue(field, value, ctx)
  }
  const seoPatch = seoPatchFromInput(seo)
  const lookup = await loadAssetLookup(ctx.orgId, {
    ids: collectAssetIds(fields, resolved, seoPatch),
    storageKeys: [],
  })
  const data = toStoredFields(fields, resolved, lookup)
  const merged = mergeSeo(undefined, seoPatch)
  if (merged) data[SEO_KEY] = merged
  return data
}

async function seedEntry(ctx: Ctx, collectionKey: string, def: DemoEntry) {
  const fields = ctx.fieldsByCollection.get(collectionKey)
  if (!fields) throw new Error(`No collection ${collectionKey}`)

  // Earlier versions first, then the final one. Each later save is a real
  // draft update, so the history panel gets one revision per version.
  const versions = [
    ...(def.earlier ?? []).map((overlay) => ({ ...def.data, ...overlay })),
    def.data,
  ]
  const first = versions[0] ?? def.data
  const created = await createEntry({
    siteId: ctx.siteId,
    collectionKey,
    data: await storeFields(ctx, fields, first, def.seo),
    actorId: ctx.actorId,
  })
  for (const version of versions.slice(1)) {
    const current = await getEntry(created.id)
    if (!current) throw new Error('Entry vanished during seeding')
    await updateDraft(
      created.id,
      await storeFields(ctx, fields, version, def.seo),
      ctx.actorId,
      current.draftVersion,
    )
  }

  if (def.nl && ctx.languages) {
    const current = await getEntry(created.id)
    if (!current) throw new Error('Entry vanished during seeding')
    const converted = await storeFields(ctx, fields, def.nl, undefined)
    const written = applyLocaleWrite({
      fields,
      languages: ctx.languages,
      locale: 'nl',
      stored: current.draftData,
      converted,
      seo: seoPatchFromInput(def.nlSeo),
    })
    await updateDraft(
      created.id,
      written.data,
      ctx.actorId,
      current.draftVersion,
    )
  }

  ctx.entryIds.set(`${collectionKey}:${def.slug}`, created.id)
  return created.id
}

async function seedClient(client: DemoClient, adminId: string) {
  const org = await createOrganization({
    name: client.name,
    slug: client.slug,
    actorId: adminId,
  })
  await inviteAndSignUp({
    name: client.owner.name,
    email: client.owner.email,
    organizationId: org.id,
    role: 'owner',
  })
  await inviteAndSignUp({
    name: client.editor.name,
    email: client.editor.email,
    organizationId: org.id,
    role: 'editor',
  })
  if (client.pendingInvite) {
    await db.insert(invitation).values({
      email: client.pendingInvite.email,
      organizationId: org.id,
      role: client.pendingInvite.role,
      tokenHash: hashToken(randomBytes(32).toString('hex')),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    })
  }

  const created = await createSite({
    organizationId: org.id,
    name: client.site.name,
    slug: client.site.slug,
    productionUrl: `https://${client.domain}`,
    actorId: adminId,
  })
  // No Dokploy deployment: releases run as demo publications, which go through
  // the same build job pipeline without a deploy step.
  await db
    .update(site)
    .set({ publishingMode: 'demo' })
    .where(eq(site.id, created.id))

  const languages = client.languages
    ? (await setSiteLanguages(created.id, client.languages, adminId)).languages
    : null

  const fieldsByCollection = new Map<string, Field[]>()
  for (const collection of client.collections) {
    await upsertCollection(
      created.id,
      {
        key: collection.key,
        label: collection.label,
        routePattern: collection.routePattern,
        fields: collection.fields,
      },
      adminId,
    )
    fieldsByCollection.set(collection.key, collection.fields)
  }
  await upsertGlobal(
    created.id,
    {
      key: client.global.key,
      label: client.global.label,
      fields: client.global.fields,
      seo: false,
    },
    adminId,
  )

  const assets = new Map<string, string>()
  for (const image of client.images) {
    const asset = await uploadAsset({
      organizationId: org.id,
      file: {
        buffer: await loadPicsum(image.picsumId),
        filename: `${image.key}.jpg`,
        mimeType: 'image/jpeg',
      },
      actorId: adminId,
      altText: image.alt,
      sourceUrl: picsumUrl(image.picsumId),
    })
    assets.set(image.key, asset.id)
  }

  const ctx: Ctx = {
    orgId: org.id,
    siteId: created.id,
    actorId: adminId,
    assets,
    entryIds: new Map(),
    fieldsByCollection,
    languages,
  }

  // Phase A: content as it stands before the first release.
  const scheduled: { id: string; def: DemoEntry }[] = []
  const ready: string[] = []
  for (const collection of client.collections) {
    for (const def of collection.entries) {
      const id = await seedEntry(ctx, collection.key, def)
      if (def.status === 'live') await publishEntry(id, adminId)
      if (def.status === 'ready') ready.push(id)
      if (def.status === 'scheduled') scheduled.push({ id, def })
    }
  }
  const section = await getGlobalEntry(created.id, client.global.key)
  if (!section) throw new Error('Global section entry missing')
  await updateDraft(
    section.entry.id,
    await storeFields(ctx, client.global.fields, client.global.values),
    adminId,
    section.entry.draftVersion,
  )
  await publishEntry(section.entry.id, adminId)

  // Phase B: the first release, built and published as a demo publication.
  const request = await requestPublication({
    siteId: created.id,
    actorId: adminId,
    note: 'Initial release',
  })
  if (!request.ok) {
    throw new Error(`Initial release failed: ${request.errors.join('; ')}`)
  }
  // No request key, so nothing is replayed and the job is always returned.
  if (!request.job) throw new Error('Initial release returned no job')
  await processJob(request.job)

  // Phase C: approvals after the release, so they show as pending changes.
  for (const id of ready) await publishEntry(id, adminId)
  for (const { id, def } of scheduled) {
    if (!def.scheduledAt || !def.timezone) {
      throw new Error(
        `Scheduled entry ${def.slug} needs scheduledAt and timezone`,
      )
    }
    await scheduleEntry(id, def.scheduledAt, def.timezone, adminId)
  }

  // Stagger edit times over fixed past dates, so cards read "Edited 3 days ago"
  // rather than "now" for every entry. Deterministic: anchored to a fixed date.
  const anchor = Date.parse('2026-10-16T09:00:00Z')
  let index = 0
  for (const id of ctx.entryIds.values()) {
    index += 1
    const days = ((index * 5) % 30) + 1
    const updatedAt = new Date(anchor - days * 24 * 60 * 60 * 1000)
    const createdAt = new Date(updatedAt.getTime() - 2 * 24 * 60 * 60 * 1000)
    await db.update(entry).set({ createdAt, updatedAt }).where(eq(entry.id, id))
  }

  return { orgId: org.id, siteId: created.id }
}

async function main() {
  assertLocalDevDatabase()

  const existingAdmin = (
    await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, ADMIN_EMAIL))
      .limit(1)
  ).at(0)
  if (existingAdmin) {
    throw new Error(
      'Demo data is already present. Run `pnpm db:reset` first, or use `pnpm db:demo`.',
    )
  }

  const adminId = await createAdmin()
  for (const client of CLIENTS) {
    console.log(`Seeding ${client.name}...`)
    await seedClient(client, adminId)
  }
  console.log('Demo seed complete.')
  console.log(`Agency admin: ${ADMIN_EMAIL} / ${PASSWORD}`)
  console.log(
    `Agency admin TOTP secret (base32): MFZGKY3BFVSGK3LPFV2G65DQFVZWKY3SMV2A`,
  )
}

try {
  await main()
} finally {
  await pool.end()
}
