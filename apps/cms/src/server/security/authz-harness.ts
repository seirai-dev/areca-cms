/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
/**
 * Shared harness for the direct-call authorization suites
 * (`authz-matrix.test.ts`, `authz-routes.test.ts`).
 *
 * The seam: the suites replace `#/lib/auth` (Better Auth) with `authz-state`,
 * so the REAL guards in `session.server.ts` / `step-up.ts` run against a REAL
 * database seeded here. Server functions are executed through
 * `__executeServer` inside a Start context, i.e. the same validator ->
 * global middleware -> handler chain the HTTP transport uses, minus the wire.
 */
import type { AsyncLocalStorage } from 'node:async_hooks'
import { isRedirect } from '@tanstack/react-router'
import { eq, like } from 'drizzle-orm'

import { db } from '#/db'
import {
  asset,
  auditLog,
  buildJob,
  invitation,
  membership,
  organization,
  publication,
  site,
  twoFactor,
  user,
  verification,
} from '#/db/schema'
import { securityErrorCode } from '#/lib/security-errors'
import { createEntry } from '#/server/content/entries'
import { ForbiddenError, NotFoundError } from '#/server/content/errors'
import {
  createTestCollection,
  createTestSite,
  sampleRichText,
} from '#/server/content/test-utils'
import { startInstance } from '#/start'

import { setCurrentSession } from './authz-state'
import type { TestSession } from './authz-state'

export type ActorName =
  | 'anonymous'
  | 'editorX'
  | 'ownerX'
  | 'ownerY'
  | 'adminNoMfa'
  | 'adminMfa'
  | 'adminStale'

export const ACTORS: ActorName[] = [
  'anonymous',
  'editorX',
  'ownerX',
  'ownerY',
  'adminNoMfa',
  'adminMfa',
  'adminStale',
]

/** What a caller is expected to get back. */
export type Expected =
  'allowed' | 'login' | 'forbidden' | 'not-found' | 'mfa' | 'reauth'

export type Policy =
  'public' | 'user' | 'org-editor' | 'org-owner' | 'agency' | 'agency-fresh'

const ALL = (value: Expected): Record<ActorName, Expected> => ({
  anonymous: value,
  editorX: value,
  ownerX: value,
  ownerY: value,
  adminNoMfa: value,
  adminMfa: value,
  adminStale: value,
})

/**
 * Expected result per policy. "X" is the organization whose data the call
 * targets; "Y" is an unrelated tenant.
 */
export const POLICY_EXPECTATIONS: Record<
  Policy,
  Record<ActorName, Expected>
> = {
  public: ALL('allowed'),
  user: { ...ALL('allowed'), anonymous: 'login' },
  'org-editor': {
    anonymous: 'login',
    editorX: 'allowed',
    ownerX: 'allowed',
    ownerY: 'forbidden',
    adminNoMfa: 'mfa',
    adminMfa: 'allowed',
    adminStale: 'allowed',
  },
  'org-owner': {
    anonymous: 'login',
    editorX: 'forbidden',
    ownerX: 'allowed',
    ownerY: 'forbidden',
    adminNoMfa: 'mfa',
    adminMfa: 'allowed',
    adminStale: 'allowed',
  },
  agency: {
    anonymous: 'login',
    editorX: 'forbidden',
    ownerX: 'forbidden',
    ownerY: 'forbidden',
    adminNoMfa: 'mfa',
    adminMfa: 'allowed',
    adminStale: 'allowed',
  },
  'agency-fresh': {
    anonymous: 'login',
    editorX: 'forbidden',
    ownerX: 'forbidden',
    ownerY: 'forbidden',
    adminNoMfa: 'mfa',
    adminMfa: 'allowed',
    adminStale: 'reauth',
  },
}

// ---------------------------------------------------------------- seeding

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

type Side = 'X' | 'Y'

export async function seedWorld() {
  const run = crypto.randomUUID().slice(0, 8)
  const x = await createTestSite()
  const y = await createTestSite()
  const colX = await createTestCollection(x.site.id)
  const colY = await createTestCollection(y.site.id)

  const userIds: string[] = [x.actor.id, y.actor.id]
  const orgIds: string[] = [x.org.id, y.org.id]

  async function makeUser(
    label: string,
    flags: { admin?: boolean; twoFactor?: boolean } = {},
  ) {
    const id = crypto.randomUUID()
    const [row] = await db
      .insert(user)
      .values({
        id,
        name: `${label} ${run}`,
        email: `${label}-${run}-${id.slice(0, 6)}@authz.test`,
        emailVerified: true,
        isAgencyAdmin: Boolean(flags.admin),
        twoFactorEnabled: Boolean(flags.twoFactor),
      })
      .returning()
    if (!row) throw new Error('user insert failed')
    userIds.push(row.id)
    if (flags.twoFactor) {
      await db.insert(twoFactor).values({
        id: crypto.randomUUID(),
        secret: 'enc-secret',
        backupCodes: 'enc-codes',
        userId: row.id,
        verified: true,
      })
    }
    return row
  }

  const sides = {
    X: { ctx: x, col: colX },
    Y: { ctx: y, col: colY },
  }

  async function freshEntry(side: Side = 'X') {
    const { ctx } = sides[side]
    const slug = `e-${crypto.randomUUID().slice(0, 8)}`
    return createEntry({
      siteId: ctx.site.id,
      collectionKey: 'articles',
      data: { title: `Entry ${slug}`, slug, body: sampleRichText },
      actorId: ctx.actor.id,
    })
  }

  async function freshOrg(label = 'org') {
    const suffix = crypto.randomUUID().slice(0, 8)
    const [row] = await db
      .insert(organization)
      .values({
        name: `Fresh ${label} ${suffix}`,
        slug: `authz-${run}-${suffix}`,
      })
      .returning()
    if (!row) throw new Error('org insert failed')
    orgIds.push(row.id)
    return row
  }

  async function freshSite(side: Side = 'X') {
    const { ctx } = sides[side]
    const suffix = crypto.randomUUID().slice(0, 8)
    const [row] = await db
      .insert(site)
      .values({
        organizationId: ctx.org.id,
        name: `Fresh site ${suffix}`,
        slug: `authz-${run}-${suffix}`,
        tokenHash: `h-${crypto.randomUUID()}`,
        schemaTokenHash: `s-${crypto.randomUUID()}`,
        productionUrl: 'http://localhost:3999',
        previewSecret: crypto.randomUUID(),
        publishingMode: 'demo',
      })
      .returning()
    if (!row) throw new Error('site insert failed')
    return row
  }

  async function freshCollection(side: Side = 'X', key?: string) {
    const { ctx } = sides[side]
    return createTestCollection(ctx.site.id, {
      key: key ?? `c${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
    })
  }

  async function freshAsset(side: Side = 'X') {
    const { ctx } = sides[side]
    const [row] = await db
      .insert(asset)
      .values({
        organizationId: ctx.org.id,
        storageKey: `authz/${run}/${crypto.randomUUID()}.png`,
        originalFilename: 'pic.png',
        mimeType: 'image/png',
        size: 10,
        altText: 'original alt',
      })
      .returning()
    if (!row) throw new Error('asset insert failed')
    return row
  }

  async function freshPublication(
    siteId: string,
    marker: string,
    status: 'live' | 'superseded' = 'live',
  ) {
    const [row] = await db
      .insert(publication)
      .values({
        siteId,
        snapshot: {
          publicationId: '',
          siteKey: marker,
          createdAt: new Date().toISOString(),
          hash: `hash-${marker}`,
          collections: {
            articles: [
              {
                id: crypto.randomUUID(),
                slug: `slug-${marker}`,
                publishedAt: null,
                data: { title: marker },
              },
            ],
          },
        },
        snapshotHash: `hash-${marker}-${crypto.randomUUID()}`,
        status,
        wasLive: true,
        publishingMode: 'production',
      })
      .returning()
    if (!row) throw new Error('publication insert failed')
    return row
  }

  async function freshJob(
    siteId: string,
    publicationId: string,
    status: 'queued' | 'succeeded' = 'queued',
  ) {
    const [row] = await db
      .insert(buildJob)
      .values({ siteId, publicationId, status })
      .returning()
    if (!row) throw new Error('job insert failed')
    return row
  }

  async function freshMembership(side: Side, role: 'owner' | 'editor') {
    const member = await makeUser(`member-${role}`)
    const [row] = await db
      .insert(membership)
      .values({
        userId: member.id,
        organizationId: sides[side].ctx.org.id,
        role,
      })
      .returning()
    if (!row) throw new Error('membership insert failed')
    return { user: member, membership: row }
  }

  async function freshInvitation(
    side: Side,
    opts: {
      email?: string
      expiresAt?: Date
      acceptedAt?: Date | null
      role?: 'owner' | 'editor'
    } = {},
  ) {
    const [row] = await db
      .insert(invitation)
      .values({
        email: opts.email ?? `invitee-${crypto.randomUUID()}@authz.test`,
        organizationId: sides[side].ctx.org.id,
        role: opts.role ?? 'editor',
        token: crypto.randomUUID() + crypto.randomUUID(),
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
        acceptedAt: opts.acceptedAt ?? null,
      })
      .returning()
    if (!row) throw new Error('invitation insert failed')
    return row
  }

  // Actors ----------------------------------------------------------------
  const editorX = await makeUser('editor-x')
  const ownerX = await makeUser('owner-x')
  const ownerY = await makeUser('owner-y')
  const adminNoMfa = await makeUser('admin-nomfa', { admin: true })
  const adminMfa = await makeUser('admin-mfa', { admin: true, twoFactor: true })
  const adminStale = await makeUser('admin-stale', {
    admin: true,
    twoFactor: true,
  })
  await db.insert(membership).values([
    { userId: editorX.id, organizationId: x.org.id, role: 'editor' },
    { userId: ownerX.id, organizationId: x.org.id, role: 'owner' },
    { userId: ownerY.id, organizationId: y.org.id, role: 'owner' },
  ])

  const sessions: Record<ActorName, TestSession> = {
    anonymous: null,
    editorX: sessionOf(editorX, new Date()),
    ownerX: sessionOf(ownerX, new Date()),
    ownerY: sessionOf(ownerY, new Date()),
    adminNoMfa: sessionOf(adminNoMfa, new Date()),
    adminMfa: sessionOf(adminMfa, new Date()),
    // Signed in 30 minutes ago and never re-verified: outside the step-up window.
    adminStale: sessionOf(adminStale, minutesAgo(30)),
  }

  // Enrolled test admins have session-bound local factor proof, independently
  // of their sign-in time. The stale actor's proof remains outside step-up.
  for (const actor of ['adminMfa', 'adminStale'] as const) {
    const principal = sessions[actor]!
    const id = `local-mfa:${principal.session.id}`
    await db
      .insert(verification)
      .values({
        id,
        identifier: id,
        value: principal.user.id,
        createdAt: principal.session.createdAt,
        updatedAt: principal.session.createdAt,
        expiresAt: principal.session.expiresAt,
      })
  }

  // Fixtures every tenant owns ----------------------------------------------
  const base = {} as Record<
    Side,
    {
      org: typeof x.org
      site: typeof x.site
      collection: typeof colX
      entry: Awaited<ReturnType<typeof freshEntry>>
      asset: Awaited<ReturnType<typeof freshAsset>>
      publication: Awaited<ReturnType<typeof freshPublication>>
      job: Awaited<ReturnType<typeof freshJob>>
      token: string
      schemaToken: string
      previewSecret: string
      marker: string
    }
  >
  for (const side of ['X', 'Y'] as const) {
    const { ctx, col } = sides[side]
    const marker = `SECRET-${side}-${run}`
    const e = await freshEntry(side)
    const a = await freshAsset(side)
    const p = await freshPublication(ctx.site.id, marker)
    const j = await freshJob(ctx.site.id, p.id, 'succeeded')
    base[side] = {
      org: ctx.org,
      site: ctx.site,
      collection: col,
      entry: e,
      asset: a,
      publication: p,
      job: j,
      token: ctx.token,
      schemaToken: ctx.schemaToken,
      previewSecret: ctx.previewSecret,
      marker,
    }
    await db.insert(auditLog).values({
      organizationId: ctx.org.id,
      siteId: ctx.site.id,
      actorId: ctx.actor.id,
      action: `authz.seed.${side}`,
      targetType: 'site',
      targetId: ctx.site.id,
      meta: null,
    })
  }

  async function destroy() {
    setCurrentSession(null)
    await db
      .delete(verification)
      .where(like(verification.identifier, `%${run}%`))
    for (const id of userIds) {
      await db
        .delete(verification)
        .where(like(verification.identifier, `%${id}%`))
    }
    await db
      .delete(organization)
      .where(like(organization.slug, `authz-${run}-%`))
    for (const id of orgIds) {
      await db.delete(organization).where(eq(organization.id, id))
    }
    for (const id of userIds) {
      await db.delete(user).where(eq(user.id, id))
    }
  }

  return {
    run,
    X: base.X,
    Y: base.Y,
    users: { editorX, ownerX, ownerY, adminNoMfa, adminMfa, adminStale },
    sessions,
    fresh: {
      entry: freshEntry,
      org: freshOrg,
      site: freshSite,
      collection: freshCollection,
      asset: freshAsset,
      publication: freshPublication,
      job: freshJob,
      membership: freshMembership,
      invitation: freshInvitation,
      user: makeUser,
    },
    destroy,
  }
}

export type World = Awaited<ReturnType<typeof seedWorld>>

function sessionOf(
  row: {
    id: string
    name: string
    email: string
    isAgencyAdmin: boolean
    twoFactorEnabled: boolean
  },
  createdAt: Date,
): NonNullable<TestSession> {
  return {
    session: {
      id: `session-${row.id}`,
      userId: row.id,
      createdAt,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      isAgencyAdmin: row.isAgencyAdmin,
      twoFactorEnabled: row.twoFactorEnabled,
    },
  }
}

// ------------------------------------------------------------- invocation

type ServerFnLike = {
  __executeServer: (opts: { data?: unknown; method?: string }) => Promise<{
    result?: unknown
    error?: unknown
  }>
  method?: string
}

export function isServerFn(value: unknown): value is ServerFnLike {
  return (
    typeof value === 'function' &&
    typeof (value as { __executeServer?: unknown }).__executeServer ===
      'function'
  )
}

const START_STORE = Symbol.for('tanstack-start:start-storage-context')

/** Run a server function as the transport would, as `actor`. */
export async function callServerFn(
  fn: ServerFnLike,
  data: unknown,
  session: TestSession,
) {
  setCurrentSession(session)
  const store = (globalThis as Record<symbol, AsyncLocalStorage<unknown>>)[
    START_STORE
  ]
  if (!store) throw new Error('Start storage context is not initialised')
  const startOptions = await startInstance.getOptions()
  const outcome = await store.run(
    {
      startOptions,
      contextAfterGlobalMiddlewares: {},
      request: new Request('http://cms.test/_serverFn/test', {
        method: fn.method ?? 'POST',
      }),
      executedRequestMiddlewares: new Set(),
    },
    () => fn.__executeServer({ data, method: fn.method }),
  )
  return outcome
}

export type Denial =
  'login' | 'forbidden' | 'mfa' | 'reauth' | 'not-found' | 'internal' | 'other'

/** Collapses whatever reached the "client" into a comparable label. */
export function classify(error: unknown): Denial {
  if (isRedirect(error)) return 'login'
  if (error instanceof Response) {
    if (error.status === 401) return 'login'
    if (error.status === 403) return 'forbidden'
    return 'other'
  }
  const code = securityErrorCode(error)
  if (code === 'MFA_REQUIRED') return 'mfa'
  if (code === 'REAUTH_REQUIRED') return 'reauth'
  if (error instanceof ForbiddenError) return 'forbidden'
  if (error instanceof NotFoundError) return 'not-found'
  if (
    error instanceof Error &&
    /^Something went wrong \(ref: [a-f0-9]+\)$/.test(error.message)
  ) {
    return 'internal'
  }
  return 'other'
}

const AUTH_DENIALS: ReadonlySet<Denial> = new Set([
  'login',
  'forbidden',
  'mfa',
  'reauth',
])

export function isAuthDenial(label: Denial) {
  return AUTH_DENIALS.has(label)
}

/** Reduce a server-fn outcome to `allowed` or the denial label. */
export function outcomeLabel(
  outcome: { error?: unknown },
  tolerant: boolean,
): Expected | Denial {
  if (!outcome.error) return 'allowed'
  const label = classify(outcome.error)
  if (tolerant && !isAuthDenial(label)) return 'allowed'
  return label
}
