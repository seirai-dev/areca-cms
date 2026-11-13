import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as DbModule from '#/db'

import { withRequestScope } from '#/server/http/request-scope.server'
import { MfaRequiredError, securityErrorCode } from './security-errors.ts'
import {
  forgetSession,
  getSession as loadCurrentSession,
  hasRole,
  requireAgencyAdmin,
  requireFreshAgencyAdmin,
  requireOrgMember,
  requireOrgMemberOrNotFound,
  requireSignedIn,
  requireUser,
} from './session.server.ts'

const getSession = vi.hoisted(() => vi.fn())
const memberRows = vi.hoisted(() => ({
  rows: [] as Array<{ role: 'editor' | 'owner' }>,
}))
vi.mock('#/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => memberRows.rows }),
      }),
    }),
  },
}))
const factorProof = vi.hoisted(() => vi.fn())
const factorVerifiedAt = vi.hoisted(() => vi.fn())
const memberFactor = vi.hoisted(() => vi.fn())
vi.mock('#/server/security/local-mfa', () => ({
  requireAdminLocalMfa: factorProof,
  requireMemberLocalMfa: memberFactor,
  localMfaVerifiedAt: factorVerifiedAt,
}))

vi.mock('#/lib/auth', () => ({ auth: { api: { getSession } } }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

function sessionFor(user: {
  isAgencyAdmin: boolean
  twoFactorEnabled: boolean
}) {
  return {
    session: { id: 'session-1', createdAt: new Date() },
    user: { id: 'user-1', ...user },
  }
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

const notFoundMarker = () => new Error('NOT_FOUND_MARKER')

function isForbidden(error: unknown) {
  return error instanceof Response && error.status === 403
}

beforeEach(() => {
  getSession.mockReset()
  memberRows.rows = []
  factorProof.mockReset()
  // The two-factor rule of the real requireAdminLocalMfa; its proof lookup is
  // covered in audit-auth-regressions.test.ts.
  factorProof.mockImplementation(
    async (principal: { user: { twoFactorEnabled: boolean } }) => {
      if (!principal.user.twoFactorEnabled) throw new MfaRequiredError()
    },
  )
  factorVerifiedAt.mockReset()
  factorVerifiedAt.mockResolvedValue(new Date())
  memberFactor.mockReset()
  memberFactor.mockResolvedValue(undefined)
})

describe('requireAgencyAdmin', () => {
  it('rejects an agency admin without two-factor with MFA_REQUIRED', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: true, twoFactorEnabled: false }),
    )
    const error = await rejection(requireAgencyAdmin())
    expect(securityErrorCode(error)).toBe('MFA_REQUIRED')
  })

  it('lets an agency admin with two-factor through', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: true, twoFactorEnabled: true }),
    )
    await expect(requireAgencyAdmin()).resolves.toMatchObject({
      user: { id: 'user-1' },
    })
  })

  it('rejects an enrolled provider session without local factor proof', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: true, twoFactorEnabled: true }),
    )
    factorProof.mockRejectedValue(
      new Error('MFA_REQUIRED: Verify your local factor'),
    )
    expect(securityErrorCode(await rejection(requireAgencyAdmin()))).toBe(
      'MFA_REQUIRED',
    )
  })

  it('answers non-admins with a plain 403, not MFA_REQUIRED', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
    )
    const error = await rejection(requireAgencyAdmin())
    expect(error).toBeInstanceOf(Response)
    expect((error as Response).status).toBe(403)
  })
})

describe('requireUser', () => {
  it('stops a two-factor session that has not entered a code', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: true }),
    )
    memberFactor.mockRejectedValue(
      new Error('MFA_REQUIRED: Enter a code from your authenticator app'),
    )
    expect(securityErrorCode(await rejection(requireUser()))).toBe(
      'MFA_REQUIRED',
    )
    // The same applies to every membership guard, which starts here.
    memberRows.rows = [{ role: 'owner' }]
    expect(
      securityErrorCode(
        await rejection(
          requireOrgMemberOrNotFound('org-1', 'owner', notFoundMarker),
        ),
      ),
    ).toBe('MFA_REQUIRED')
  })

  it('leaves requireSignedIn open, so the code can be entered', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: true }),
    )
    memberFactor.mockRejectedValue(new Error('MFA_REQUIRED: code'))
    await expect(requireSignedIn()).resolves.toMatchObject({
      user: { id: 'user-1' },
    })
    expect(memberFactor).not.toHaveBeenCalled()
  })
})

describe('requireOrgMember', () => {
  it('applies the two-factor rule to the agency-admin shortcut', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: true, twoFactorEnabled: false }),
    )
    const error = await rejection(requireOrgMember('org-1'))
    expect(securityErrorCode(error)).toBe('MFA_REQUIRED')
  })

  it('lets an enrolled agency admin into any organization', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: true, twoFactorEnabled: true }),
    )
    await expect(requireOrgMember('org-1', 'owner')).resolves.toBeDefined()
  })
})

describe('requireFreshAgencyAdmin', () => {
  it('stops at MFA_REQUIRED before looking at freshness', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: true, twoFactorEnabled: false }),
    )
    const error = await rejection(requireFreshAgencyAdmin())
    expect(securityErrorCode(error)).toBe('MFA_REQUIRED')
  })

  it('passes for an enrolled admin with fresh local factor proof', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: true, twoFactorEnabled: true }),
    )
    await expect(requireFreshAgencyAdmin()).resolves.toBeDefined()
  })
})

describe('membership roles', () => {
  it('ranks owner above editor, and a role satisfies itself', () => {
    expect(hasRole('owner', 'editor')).toBe(true)
    expect(hasRole('owner', 'owner')).toBe(true)
    expect(hasRole('editor', 'editor')).toBe(true)
    expect(hasRole('editor', 'owner')).toBe(false)
  })

  it('answers a non-member with notFound, whatever role is asked', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
    )
    for (const role of [undefined, 'editor', 'owner'] as const) {
      const error = await rejection(
        requireOrgMemberOrNotFound('org-1', role, notFoundMarker),
      )
      expect(error).toEqual(new Error('NOT_FOUND_MARKER'))
    }
  })

  it('keeps the 403 for a member whose role is too low', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
    )
    memberRows.rows = [{ role: 'editor' }]
    const error = await rejection(
      requireOrgMemberOrNotFound('org-1', 'owner', notFoundMarker),
    )
    expect(isForbidden(error)).toBe(true)
  })

  it('lets a member through with the role or with no role asked', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
    )
    memberRows.rows = [{ role: 'owner' }]
    await expect(
      requireOrgMemberOrNotFound('org-1', 'owner', notFoundMarker),
    ).resolves.toMatchObject({ user: { id: 'user-1' } })
    memberRows.rows = [{ role: 'editor' }]
    await expect(
      requireOrgMemberOrNotFound('org-1', undefined, notFoundMarker),
    ).resolves.toBeDefined()
  })

  it('applies the same role rule in requireOrgMember', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
    )
    memberRows.rows = [{ role: 'editor' }]
    expect(
      isForbidden(await rejection(requireOrgMember('org-1', 'owner'))),
    ).toBe(true)
    // A non-member is a plain 403 here: only the OrNotFound variant maps it.
    memberRows.rows = []
    expect(
      isForbidden(await rejection(requireOrgMember('org-1', 'owner'))),
    ).toBe(true)
  })

  it('lets an enrolled agency admin through any role, without a membership row', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: true, twoFactorEnabled: true }),
    )
    await expect(
      requireOrgMemberOrNotFound('org-1', 'owner', notFoundMarker),
    ).resolves.toBeDefined()
    expect(factorProof).toHaveBeenCalledTimes(1)
  })
})

describe('session memo', () => {
  it('reads the session once across the guards of one request', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
    )
    memberRows.rows = [{ role: 'owner' }]
    await withRequestScope(async () => {
      await loadCurrentSession()
      await requireUser()
      await requireOrgMemberOrNotFound('org-1', 'owner', notFoundMarker)
    })
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('reads again in the next request', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
    )
    await withRequestScope(() => loadCurrentSession())
    await withRequestScope(() => loadCurrentSession())
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('reads fresh outside a request', async () => {
    getSession.mockResolvedValue(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
    )
    await loadCurrentSession()
    await loadCurrentSession()
    expect(getSession).toHaveBeenCalledTimes(2)
  })

  it('reads fresh after forgetSession, for a session that just ended', async () => {
    getSession.mockResolvedValueOnce(
      sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
    )
    getSession.mockResolvedValueOnce(null)
    await withRequestScope(async () => {
      await expect(loadCurrentSession()).resolves.not.toBeNull()
      forgetSession()
      await expect(loadCurrentSession()).resolves.toBeNull()
    })
  })

  it('keeps the blocked-user rejection on the memoized session', async () => {
    getSession.mockResolvedValue({
      ...sessionFor({ isAgencyAdmin: false, twoFactorEnabled: false }),
      user: { id: 'user-1', blockedAt: new Date() },
    })
    await withRequestScope(async () => {
      const first = await rejection(requireUser())
      expect(first).toBeDefined()
      expect(await rejection(requireUser())).toBeDefined()
    })
    expect(getSession).toHaveBeenCalledTimes(1)
  })
})
