import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '#/db'
import { auditLog, notificationRule, organization } from '#/db/schema'
import type { EventKey } from '#/lib/notifications'
import { ConflictError, ValidationError } from '#/server/content/errors'

import { writeRule } from './preferences.ts'
import {
  buildAgencyMatrices,
  buildOrgMatrix,
  getMyNotifications,
  setAgencyRule,
  setMyPreference,
  setOrgRule,
} from './rules.ts'
import {
  addMember,
  createTestSite,
  makeUser,
  removeUsers,
} from './test-utils.ts'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
})

async function setup() {
  const ctx = await createTestSite()
  const owner = await makeUser({ name: 'Mo Owner' })
  const editor = await makeUser({ name: 'Ed Editor' })
  const admin = await makeUser({ name: 'Ada Agency', agencyAdmin: true })
  await addMember(owner.id, ctx.org.id, 'owner')
  await addMember(editor.id, ctx.org.id, 'editor')
  cleanups.push(async () => {
    await db.delete(organization).where(eq(organization.id, ctx.org.id))
    await removeUsers([owner.id, editor.id, admin.id, ctx.actor.id])
  })
  return { ...ctx, owner, editor, admin }
}

/** Global agency rules are shared by every test file, so each one is removed here. */
function cleanAgencyRule(event: EventKey, role: 'owner' | 'editor' | 'agency') {
  cleanups.push(async () => {
    await db
      .delete(notificationRule)
      .where(
        and(
          eq(notificationRule.scope, 'agency'),
          eq(notificationRule.event, event),
          eq(notificationRule.role, role),
        ),
      )
  })
}

describe('setMyPreference', () => {
  it('saves a member choice and reports it back on the account screen', async () => {
    const { owner, org } = await setup()

    const result = await setMyPreference({
      userId: owner.id,
      organizationId: org.id,
      event: 'release.live',
      enabled: false,
    })

    expect(result).toEqual({ ok: true })
    const mine = await getMyNotifications(owner.id)
    const row = mine.orgs
      .find((entry) => entry.organizationId === org.id)
      ?.events.find((event) => event.event === 'release.live')
    expect(row).toEqual({
      event: 'release.live',
      enabled: false,
      lockedBy: null,
    })
    const audited = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, org.id),
          eq(auditLog.actorId, owner.id),
          eq(auditLog.action, 'notification_preference.update'),
        ),
      )
    expect(audited.length).toBeGreaterThan(0)
  })

  it('refuses a change to an organization-locked event and names the organization', async () => {
    const { owner, org } = await setup()
    await writeRule({
      organizationId: org.id,
      event: 'release.failed',
      role: 'owner',
      enabled: true,
      locked: true,
      updatedBy: owner.id,
    })
    cleanups.push(async () => {
      await db
        .delete(notificationRule)
        .where(eq(notificationRule.organizationId, org.id))
    })

    const result = await setMyPreference({
      userId: owner.id,
      organizationId: org.id,
      event: 'release.failed',
      enabled: false,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(org.name)
  })

  it('refuses a change to an agency-locked event and names the agency', async () => {
    const { owner, org } = await setup()
    cleanAgencyRule('invite.accepted', 'owner')
    await setAgencyRule({
      actorId: owner.id,
      request: {
        event: 'invite.accepted',
        role: 'owner',
        enabled: true,
        locked: true,
      },
    })

    const result = await setMyPreference({
      userId: owner.id,
      organizationId: org.id,
      event: 'invite.accepted',
      enabled: false,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/required by/i)
  })

  it('accepts "on" for a locked event, since it is already on', async () => {
    const { owner, org } = await setup()
    await writeRule({
      organizationId: org.id,
      event: 'release.failed',
      role: 'owner',
      enabled: true,
      locked: true,
      updatedBy: owner.id,
    })
    cleanups.push(async () => {
      await db
        .delete(notificationRule)
        .where(eq(notificationRule.organizationId, org.id))
    })

    const result = await setMyPreference({
      userId: owner.id,
      organizationId: org.id,
      event: 'release.failed',
      enabled: true,
    })

    expect(result).toEqual({ ok: true })
  })

  it('rejects events the caller role does not get', async () => {
    const { editor, org } = await setup()

    const result = await setMyPreference({
      userId: editor.id,
      organizationId: org.id,
      event: 'release.live.others',
      enabled: true,
    })

    expect(result.ok).toBe(false)
  })

  it('rejects an org the caller is not a member of', async () => {
    const { owner } = await setup()
    const other = await createTestSite()
    cleanups.push(async () => {
      await db.delete(organization).where(eq(organization.id, other.org.id))
      await removeUsers([other.actor.id])
    })

    const result = await setMyPreference({
      userId: owner.id,
      organizationId: other.org.id,
      event: 'release.live',
      enabled: false,
    })

    expect(result.ok).toBe(false)
  })

  it('saves an agency-alert choice for an agency admin on the global scope', async () => {
    const { admin } = await setup()

    const result = await setMyPreference({
      userId: admin.id,
      organizationId: null,
      event: 'agency.release.failed',
      enabled: false,
    })

    expect(result).toEqual({ ok: true })
    const mine = await getMyNotifications(admin.id)
    expect(mine.agency?.events).toContainEqual({
      event: 'agency.release.failed',
      enabled: false,
      lockedBy: null,
    })
  })
})

describe('organization rules', () => {
  it('shows a lock as on and required, and marks the cell as overridden', async () => {
    const { owner, org } = await setup()
    cleanups.push(async () => {
      await db
        .delete(notificationRule)
        .where(eq(notificationRule.organizationId, org.id))
    })

    const matrix = await setOrgRule({
      organizationId: org.id,
      actorId: owner.id,
      request: {
        event: 'release.live',
        role: 'owner',
        enabled: false,
        locked: true,
      },
    })

    const cell = matrix.rows.find((row) => row.event === 'release.live')?.cells
      .owner
    // A lock is always on: saving "off" with a lock stores on.
    expect(cell).toEqual({
      enabled: true,
      locked: true,
      overridden: true,
      lockedAbove: false,
    })
    expect(matrix.orgName).toBe(org.name)
  })

  it('clears an override so the built-in default applies again', async () => {
    const { owner, org } = await setup()
    await setOrgRule({
      organizationId: org.id,
      actorId: owner.id,
      request: {
        event: 'release.live.others',
        role: 'owner',
        enabled: true,
        locked: false,
      },
    })

    const matrix = await setOrgRule({
      organizationId: org.id,
      actorId: owner.id,
      request: { event: 'release.live.others', role: 'owner', clear: true },
    })

    const cell = matrix.rows.find((row) => row.event === 'release.live.others')
      ?.cells.owner
    expect(cell).toEqual({
      enabled: false,
      locked: false,
      overridden: false,
      lockedAbove: false,
    })
  })

  it('refuses to change a cell an agency has locked, and shows it as locked above', async () => {
    const { owner, org } = await setup()
    cleanAgencyRule('schedule.published', 'owner')
    await setAgencyRule({
      actorId: owner.id,
      request: {
        event: 'schedule.published',
        role: 'owner',
        enabled: true,
        locked: true,
      },
    })

    await expect(
      setOrgRule({
        organizationId: org.id,
        actorId: owner.id,
        request: {
          event: 'schedule.published',
          role: 'owner',
          enabled: false,
          locked: false,
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    const matrix = await buildOrgMatrix(org.id)
    const cell = matrix.rows.find((row) => row.event === 'schedule.published')
      ?.cells.owner
    expect(cell).toMatchObject({
      enabled: true,
      locked: true,
      lockedAbove: true,
    })
  })

  it('refuses a role that the event never reaches, such as agency for a client rule', async () => {
    const { owner, org } = await setup()

    await expect(
      setOrgRule({
        organizationId: org.id,
        actorId: owner.id,
        request: {
          event: 'release.live',
          role: 'agency',
          enabled: true,
          locked: false,
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('records every rule change in the audit log', async () => {
    const { owner, org } = await setup()
    cleanups.push(async () => {
      await db
        .delete(notificationRule)
        .where(eq(notificationRule.organizationId, org.id))
    })

    await setOrgRule({
      organizationId: org.id,
      actorId: owner.id,
      request: {
        event: 'release.stuck',
        role: 'editor',
        enabled: true,
        locked: false,
      },
    })

    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, org.id),
          eq(auditLog.action, 'notification_rule.update'),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.meta).toMatchObject({
      event: 'release.stuck',
      role: 'editor',
      enabled: true,
      locked: false,
    })
  })
})

describe('agency rules', () => {
  it('sets a client default lock that every client matrix shows as locked above', async () => {
    const { owner, org } = await setup()
    cleanAgencyRule('release.stuck', 'owner')

    const matrices = await setAgencyRule({
      actorId: owner.id,
      request: {
        event: 'release.stuck',
        role: 'owner',
        enabled: true,
        locked: true,
      },
    })

    expect(
      matrices.clients.rows.find((row) => row.event === 'release.stuck')?.cells
        .owner,
    ).toEqual({
      enabled: true,
      locked: true,
      overridden: true,
      lockedAbove: false,
    })
    const clientMatrix = await buildOrgMatrix(org.id)
    expect(
      clientMatrix.rows.find((row) => row.event === 'release.stuck')?.cells
        .owner,
    ).toMatchObject({ enabled: true, locked: true, lockedAbove: true })

    const cleared = await setAgencyRule({
      actorId: owner.id,
      request: { event: 'release.stuck', role: 'owner', clear: true },
    })
    expect(
      cleared.clients.rows.find((row) => row.event === 'release.stuck')?.cells
        .owner?.overridden,
    ).toBe(false)
  })

  it('lists agency alerts only in the agency matrix', async () => {
    const { owner } = await setup()

    const matrices = await buildAgencyMatrices()

    expect(matrices.agency.rows.map((row) => row.event)).toContain(
      'agency.release.failed',
    )
    expect(matrices.clients.rows.map((row) => row.event)).not.toContain(
      'agency.release.failed',
    )
    expect(owner.id).toBeTruthy()
  })
})

describe('getMyNotifications', () => {
  it('lists org events for the caller role and agency alerts only for agency admins', async () => {
    const { owner, admin, org } = await setup()

    const asOwner = await getMyNotifications(owner.id)
    expect(asOwner.agency).toBeNull()
    expect(asOwner.emailVerified).toBe(true)
    const ownerOrg = asOwner.orgs.find(
      (entry) => entry.organizationId === org.id,
    )
    expect(ownerOrg?.role).toBe('owner')
    expect(ownerOrg?.events.map((row) => row.event)).toContain(
      'release.live.others',
    )

    const asAdmin = await getMyNotifications(admin.id)
    expect(asAdmin.orgs).toEqual([])
    expect(asAdmin.agency?.events.map((row) => row.event)).toContain(
      'agency.release.failed',
    )
    expect(asAdmin.agencyName.length).toBeGreaterThan(0)
  })
})
