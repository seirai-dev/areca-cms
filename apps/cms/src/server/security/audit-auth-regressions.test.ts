import { and, eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db, pool } from '#/db'
import {
  account,
  auditLog,
  invitation,
  membership,
  organization,
  user,
  verification,
} from '#/db/schema'
import { auth } from '#/lib/auth'
import type * as EnvModule from '#/env'
import type * as AuditModule from '#/server/audit'
import { assertEmailMayRegister } from '#/server/auth/registration-gate'
import {
  acceptInvitation,
  inviteMember,
  revokeInvitation,
} from '#/server/admin/members'
import { completeSetup } from '#/server/admin/setup'
import { deleteOrganization } from '#/server/admin/organizations'
import { createTestSite } from '#/server/content/test-utils'
import { localMfaVerifiedAt, requireAdminLocalMfa } from './local-mfa'
import {
  clearStepUpFailures,
  isStepUpLocked,
  recordStepUpFailure,
} from './step-up'
import { resetAdminFactorLockout } from './reset-factor-lockout'
import { handleLocalFactorRequest } from './factor-http'

vi.mock('#/env', async (original) => {
  const actual = await original<typeof EnvModule>()
  return {
    env: {
      ...actual.env,
      SETUP_TOKEN: 'audit-setup-token-0123456789',
      ADMIN_MFA_REQUIRED: true,
    },
  }
})

const injected = vi.hoisted(() => ({ failSetupAudit: false }))
vi.mock('#/server/audit', async (original) => {
  const actual = await original<typeof AuditModule>()
  return {
    ...actual,
    audit: async (...args: Parameters<typeof actual.audit>) => {
      if (injected.failSetupAudit && args[0].action === 'setup.completed')
        throw new Error('Injected audit failure')
      return actual.audit(...args)
    },
  }
})

const isolated = process.env.DATABASE_URL?.endsWith('/areca_audit_auth')
const users: string[] = []
const orgs: string[] = []

async function makeUser(admin = false) {
  const id = crypto.randomUUID()
  users.push(id)
  const [created] = await db
    .insert(user)
    .values({
      id,
      email: `${id}@audit.test`,
      name: 'Audit',
      isAgencyAdmin: admin,
      twoFactorEnabled: admin,
    })
    .returning()
  return created
}
async function makeOrg() {
  const [created] = await db
    .insert(organization)
    .values({ name: '<b>Client</b>', slug: crypto.randomUUID() })
    .returning()
  orgs.push(created.id)
  return created
}
async function makeInvite(target: typeof user.$inferSelect, orgId: string) {
  const [created] = await db
    .insert(invitation)
    .values({
      email: target.email,
      organizationId: orgId,
      role: 'editor',
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning()
  return created
}

afterEach(async () => {
  injected.failSetupAudit = false
  for (const id of orgs.splice(0))
    await db.delete(organization).where(eq(organization.id, id))
  for (const id of users.splice(0)) {
    await clearStepUpFailures(id)
    await db.delete(user).where(eq(user.id, id))
  }
})

// These bootstrap tests must never clean or depend on a development database.
describe.skipIf(!isolated)(
  'audit auth regression boundaries (isolated database)',
  () => {
    it('blocks public signup on an empty instance without creating a user', async () => {
      expect(await db.select().from(user)).toHaveLength(0)
      await expect(
        auth.api.signUpEmail({
          body: {
            name: 'Intruder',
            email: 'intruder@audit.test',
            password: 'password123',
          },
        }),
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(await db.select().from(user)).toHaveLength(0)
    })

    it('requires possession of the matching invitation for password signup', async () => {
      const existing = await makeUser()
      const org = await makeOrg()
      const email = `${crypto.randomUUID()}@audit.test`
      const [invite] = await db
        .insert(invitation)
        .values({
          email,
          organizationId: org.id,
          role: 'owner',
          token: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning()
      const signup = { name: 'Recipient', email, password: 'password123' }
      await expect(
        auth.api.signUpEmail({ body: signup }),
      ).rejects.toMatchObject({ statusCode: 403 })
      const incorrectSignup = { ...signup, invitationToken: 'incorrect' }
      await expect(
        auth.api.signUpEmail({ body: incorrectSignup }),
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(
        await db.select().from(user).where(eq(user.email, email)),
      ).toHaveLength(0)
      const invitedSignup = { ...signup, invitationToken: invite.token }
      const result = await auth.api.signUpEmail({ body: invitedSignup })
      users.push(result.user.id)
      expect(result.user.email).toBe(email)
      expect(
        await db
          .select()
          .from(account)
          .where(eq(account.userId, result.user.id)),
      ).toHaveLength(1)
      await expect(
        assertEmailMayRegister(email, {
          passwordSignup: false,
          emailVerified: false,
        }),
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(existing.id).not.toBe(result.user.id)
    })

    it('answers an existing account and a missing invitation with the same refusal', async () => {
      const existing = await makeUser()
      const org = await makeOrg()
      const invite = await makeInvite(existing, org.id)
      const withInvite = await auth.api
        .signUpEmail({
          body: {
            name: 'Again',
            email: existing.email,
            password: 'password123',
            invitationToken: invite.token,
          },
        })
        .catch((error: unknown) => error)
      const withoutInvite = await auth.api
        .signUpEmail({
          body: {
            name: 'Stranger',
            email: `${crypto.randomUUID()}@audit.test`,
            password: 'password123',
            invitationToken: 'incorrect',
          },
        })
        .catch((error: unknown) => error)
      expect(withInvite).toMatchObject({ statusCode: 403 })
      expect(withoutInvite).toMatchObject({ statusCode: 403 })
      expect((withInvite as { body: unknown }).body).toEqual(
        (withoutInvite as { body: unknown }).body,
      )
    })

    it('audits a password sign-in and never records the password', async () => {
      const person = await makeUser()
      const password = 'password123'
      await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: person.id,
        providerId: 'credential',
        userId: person.id,
        password: await hashPassword(password),
      })
      await auth.api.signInEmail({ body: { email: person.email, password } })
      const events = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.actorId, person.id),
            eq(auditLog.action, 'user.sign_in'),
          ),
        )
      expect(events).toHaveLength(1)
      expect(events[0]?.meta).toMatchObject({ sessionId: expect.any(String) })
      expect(JSON.stringify(events[0]?.meta)).not.toContain(password)
    })

    it('rolls back bootstrap credentials and admin together after an audit failure', async () => {
      expect(await db.select().from(user)).toHaveLength(0)
      const input = {
        name: 'Admin',
        email: 'setup@audit.test',
        password: 'password123',
        setupToken: 'audit-setup-token-0123456789',
      }
      injected.failSetupAudit = true
      await expect(completeSetup(input)).rejects.toThrow(
        'Injected audit failure',
      )
      expect(await db.select().from(user)).toHaveLength(0)
      expect(await db.select().from(account)).toHaveLength(0)
      injected.failSetupAudit = false
      const created = await completeSetup(input)
      users.push(created.id)
      expect(created.isAgencyAdmin).toBe(true)
    })

    it('accepts the same invitation concurrently and repeatedly without changing the role', async () => {
      const target = await makeUser()
      const org = await makeOrg()
      const invite = await makeInvite(target, org.id)
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          acceptInvitation({ token: invite.token, userId: target.id }),
        ),
      )
      expect(results.every((result) => result.role === 'editor')).toBe(true)
      expect(
        await db
          .select()
          .from(membership)
          .where(eq(membership.userId, target.id)),
      ).toHaveLength(1)
      await db
        .update(membership)
        .set({ role: 'owner' })
        .where(eq(membership.userId, target.id))
      expect(
        (await acceptInvitation({ token: invite.token, userId: target.id }))
          .role,
      ).toBe('owner')
      await db.delete(membership).where(eq(membership.userId, target.id))
      await expect(
        acceptInvitation({ token: invite.token, userId: target.id }),
      ).rejects.toThrow()
    })

    it('serializes revoke and accept so no revoked invitation grants membership', async () => {
      const target = await makeUser()
      const org = await makeOrg()
      const invite = await makeInvite(target, org.id)
      const results = await Promise.allSettled([
        revokeInvitation(invite.id, target.id),
        acceptInvitation({ token: invite.token, userId: target.id }),
      ])
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1)
      const members = await db
        .select()
        .from(membership)
        .where(eq(membership.userId, target.id))
      expect(members).toHaveLength(results[1].status === 'fulfilled' ? 1 : 0)
    })

    it('rechecks membership when acceptance commits before queued invitation creation', async () => {
      const actor = await makeUser(true)
      const recipient = await makeUser()
      const org = await makeOrg()
      const invite = await makeInvite(recipient, org.id)
      const gate = await pool.connect()
      const tuple = JSON.stringify(['invitation', org.id, recipient.email])
      async function waitForQueuedLocks(expected: number) {
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
          const result = await gate.query(
            `SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
          )
          if (result.rows[0].count >= expected) return
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        throw new Error('Invitation mutation did not reach the tuple lock')
      }
      await gate.query('BEGIN')
      await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        tuple,
      ])
      try {
        const accepted = acceptInvitation({
          token: invite.token,
          userId: recipient.id,
        })
        await waitForQueuedLocks(1)
        const invited = inviteMember({
          organizationId: org.id,
          email: recipient.email,
          role: 'owner',
          actorId: actor.id,
        }).then(
          () => null,
          (error: unknown) => error,
        )
        await waitForQueuedLocks(2)
        await gate.query('COMMIT')
        await accepted
        expect(await invited).toMatchObject({
          message: expect.stringMatching(/already a member/i),
        })
        const rows = await db
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, org.id),
              eq(invitation.email, recipient.email),
            ),
          )
        expect(rows).toHaveLength(1)
        expect(rows[0].acceptedAt).toBeInstanceOf(Date)
      } finally {
        await gate.query('ROLLBACK')
        gate.release()
      }
    })

    it('rejects parallel duplicate invitations even with different roles', async () => {
      const actor = await makeUser()
      const org = await makeOrg()
      const email = `${crypto.randomUUID()}@audit.test`
      const results = await Promise.allSettled(
        ['owner', 'editor'].map((role) =>
          inviteMember({
            organizationId: org.id,
            email,
            role: role as 'owner' | 'editor',
            actorId: actor.id,
          }),
        ),
      )
      const rows = await db
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, org.id),
            eq(invitation.email, email),
          ),
        )
      expect(rows).toHaveLength(1)
      expect(
        results.some(
          (result) =>
            result.status === 'rejected' &&
            String(result.reason).includes('pending'),
        ),
      ).toBe(true)
    })

    it('refuses client deletion while a site exists', async () => {
      const actor = await makeUser()
      const ctx = await createTestSite()
      orgs.push(ctx.org.id)
      users.push(ctx.actor.id)
      await expect(deleteOrganization(ctx.org.id, actor.id)).rejects.toThrow(
        'sites',
      )
    })

    it('rejects enrolled admin sessions unless that exact session verified a factor', async () => {
      const actor = await makeUser(true)
      const id = crypto.randomUUID()
      const principal = { user: actor, session: { id } }
      await expect(requireAdminLocalMfa(principal)).rejects.toThrow(
        'MFA_REQUIRED',
      )
      await db.insert(verification).values({
        id: `local-mfa:${id}`,
        identifier: `local-mfa:${id}`,
        value: actor.id,
        expiresAt: new Date(Date.now() + 60_000),
      })
      await expect(requireAdminLocalMfa(principal)).resolves.toBeUndefined()
      expect(
        await localMfaVerifiedAt({
          ...principal,
          session: { id: crypto.randomUUID() },
        }),
      ).toBeNull()
      await db
        .delete(verification)
        .where(eq(verification.id, `local-mfa:${id}`))
    })

    it('shares the failure budget with direct HTTP factor attempts across sessions', async () => {
      const target = await makeUser(true)
      let checked = 0
      const responses = await Promise.all(
        Array.from({ length: 7 }, (_, index) =>
          handleLocalFactorRequest(
            new Request('http://localhost/api/auth/two-factor/verify-totp', {
              method: 'POST',
              headers: { cookie: `session=${index}` },
            }),
            async () => {
              checked++
              return Response.json({ message: 'INVALID_CODE' }, { status: 400 })
            },
            async () => ({ user: { id: target.id } }),
          ),
        ),
      )
      expect(checked).toBe(5)
      expect(
        responses.filter((response) => response.status === 403),
      ).toHaveLength(2)
      expect(await isStepUpLocked(target.id)).toBe(true)
      await clearStepUpFailures(target.id)
    })

    it('counts parallel failures across sessions and resets only the failure counter', async () => {
      const target = await makeUser(true)
      const actor = await makeUser(true)
      await Promise.all(
        Array.from({ length: 5 }, () => recordStepUpFailure(target.id)),
      )
      expect(await isStepUpLocked(target.id)).toBe(true)
      const rows = await db
        .select()
        .from(verification)
        .where(eq(verification.identifier, `step-up-failures:${target.id}`))
      expect(rows).toHaveLength(1)
      expect(rows[0].value).toBe('5')
      await expect(
        resetAdminFactorLockout(target.id, target.id),
      ).rejects.toThrow('another')
      await resetAdminFactorLockout(target.id, actor.id)
      expect(await isStepUpLocked(target.id)).toBe(false)
      const [unchanged] = await db
        .select()
        .from(user)
        .where(eq(user.id, target.id))
      expect(unchanged.twoFactorEnabled).toBe(true)
      await expect(
        requireAdminLocalMfa({
          user: unchanged,
          session: { id: crypto.randomUUID() },
        }),
      ).rejects.toThrow('MFA_REQUIRED')
    })
  },
)
