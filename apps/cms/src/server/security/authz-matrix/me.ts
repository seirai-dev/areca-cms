import type * as meFns from '#/server/fn/me'

import type { MatrixFor } from './shared'

export const meRows = {
  getMeFn: {
    policy: 'public',
    note: 'Returns null when anonymous; otherwise only the caller own profile (also for an admin who still has to enrol two-factor, so the UI can show enrolment).',
  },
  getInvitationFn: {
    policy: 'public',
    tolerant: true,
    note: 'Bearer-token gated (unguessable invitation token); unknown token is NotFound.',
    prepare: () => ({ data: { token: 'unknown-token' } }),
  },
  acceptInvitationFn: {
    policy: 'user',
    tolerant: true,
    note: 'Any signed-in user; the invitation token + matching e-mail do the authorization (tested separately).',
    prepare: () => ({ data: { token: 'unknown-token' } }),
  },
} satisfies MatrixFor<typeof meFns>
