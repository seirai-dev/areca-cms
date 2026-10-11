import { beforeEach, describe, expect, it, vi } from 'vitest'

import { securityErrorCode } from './security-errors.ts'
import {
  assertAdminMfa,
  requireAgencyAdmin,
  requireFreshAgencyAdmin,
  requireOrgMember,
} from './session.server.ts'

const getSession = vi.hoisted(() => vi.fn())
const factorProof = vi.hoisted(() => vi.fn())
const factorVerifiedAt = vi.hoisted(() => vi.fn())
vi.mock('#/server/security/local-mfa', () => ({
  requireAdminLocalMfa: factorProof,
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

beforeEach(() => {
  getSession.mockReset()
  factorProof.mockReset()
  factorProof.mockResolvedValue(undefined)
  factorVerifiedAt.mockReset()
  factorVerifiedAt.mockResolvedValue(new Date())
})

describe('assertAdminMfa', () => {
  it('requires two-factor when enforcement is on', () => {
    expect(() => assertAdminMfa({ twoFactorEnabled: false }, true)).toThrow()
    expect(() => assertAdminMfa({}, true)).toThrow()
    expect(() => assertAdminMfa({ twoFactorEnabled: true }, true)).not.toThrow()
  })

  it('does nothing when enforcement is off', () => {
    expect(() =>
      assertAdminMfa({ twoFactorEnabled: false }, false),
    ).not.toThrow()
  })
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
