/**
 * Mutable "who is calling" state for the authorization suites.
 *
 * Deliberately import-free: `vi.mock` factories load this module while the
 * mocked module graph is still being resolved, so it must not pull in
 * anything that imports `#/lib/auth` itself.
 */
export type TestSession = {
  session: { id: string; userId: string; createdAt: Date; expiresAt: Date }
  user: {
    id: string
    name: string
    email: string
    isAgencyAdmin: boolean
    twoFactorEnabled: boolean
  }
} | null

let current: TestSession = null

export function setCurrentSession(next: TestSession) {
  current = next
}

export function currentSession(): TestSession {
  return current
}

/** Replacement for `#/lib/auth`: only the calls the guards make. */
export function fakeAuth() {
  return {
    auth: {
      api: {
        getSession: async () => current,
        verifyTOTP: async () => {
          throw new Error('INVALID_CODE')
        },
      },
    },
  }
}
