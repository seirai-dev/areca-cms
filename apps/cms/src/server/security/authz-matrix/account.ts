import type * as accountFns from '#/server/fn/account'

import type { MatrixFor } from './shared'

export const accountRows = {
  getPasswordResetAvailabilityFn: {
    policy: 'public',
    note: 'Public by design: the forgot-password link depends on it. Reveals only whether mail and password sign-in are set up.',
  },
  checkPasswordResetTokenFn: {
    policy: 'public',
    note: 'Public by design: the reset page checks its link. Reveals only whether a 24-character random token is still valid.',
    prepare: () => ({ data: { token: 'not-a-real-token' } }),
  },
  requestVerificationEmailFn: {
    policy: 'user',
    tolerant: true,
    note: 'Sends to the caller own address only; allowed callers may get a readable mail failure.',
  },
  updateEmailLocaleFn: {
    policy: 'user',
    note: 'Changes only the caller own language.',
    prepare: () => ({ data: { locale: 'en' } }),
  },
  listMySessionsFn: {
    policy: 'user',
    doc: 'any signed-in user, own live sessions only, never tokens; agency admins need local MFA',
    note: 'Lists only the caller own live sessions, without tokens (asserted in own-sessions.test.ts).',
    override: { adminNoMfa: 'mfa' },
  },
  revokeMySessionFn: {
    policy: 'user',
    doc: 'any signed-in user, own other sessions only (current session refused, NotFound for others); agency admins need local MFA',
    tolerant: true,
    note: 'Own sessions only. An unknown id answers NotFound for every signed-in caller; ownership and the current-session refusal are asserted in own-sessions.test.ts.',
    override: { adminNoMfa: 'mfa' },
    prepare: () => ({ data: { sessionId: 'no-such-session' } }),
  },
  revokeMyOtherSessionsFn: {
    policy: 'user',
    doc: 'any signed-in user, own other sessions only; agency admins need local MFA',
    note: 'Revokes only the caller own other sessions; the current session is kept.',
    override: { adminNoMfa: 'mfa' },
  },
  sendPasswordResetLinkFn: {
    policy: 'agency',
    tolerant: true,
    note: 'Sends to the seeded editor address. Allowed callers may get a readable mail failure.',
    prepare: (w) => ({ data: { userId: w.users.editorX.id } }),
  },
  getMyAccountFn: {
    policy: 'user',
    doc: 'any signed-in user, own password flag and deletion blockers only; agency admins need local MFA',
    note: 'Own password flag and deletion blockers only; no hash or other person data.',
    override: { adminNoMfa: 'mfa' },
  },
  getMySignInMethodFn: {
    policy: 'user',
    note: 'Own password flag and linked sign-in provider only. Open to admins without two-factor so they can enrol.',
  },
  updateMyNameFn: {
    policy: 'user',
    doc: 'any signed-in user, own name only; agency admins need local MFA',
    note: 'Renames only the caller.',
    override: { adminNoMfa: 'mfa' },
    prepare: () => ({ data: { name: 'Self Renamed' } }),
  },
  deleteMyAccountFn: {
    policy: 'user',
    doc: 'any signed-in user, own account only, after re-verifying the password or a second factor; agency admins need local MFA',
    note: 'Refused for every caller here: the typed email never matches, so no seeded account can be deleted by the matrix. The real delete paths are asserted in users.db.test.ts.',
    override: {
      editorX: 'forbidden',
      ownerX: 'forbidden',
      ownerY: 'forbidden',
      adminNoMfa: 'mfa',
      adminMfa: 'forbidden',
      adminStale: 'forbidden',
    },
    prepare: () => ({ data: { confirmEmail: 'nobody@authz.test' } }),
  },
} satisfies MatrixFor<typeof accountFns>
