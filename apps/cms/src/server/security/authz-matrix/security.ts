import type * as securityFns from '#/server/fn/security'

import type { MatrixFor } from './shared'

export const securityRows = {
  verifyStepUpFn: {
    policy: 'user',
    tolerant: true,
    note: 'Needs a session with two-factor enabled; everyone else gets ForbiddenError.',
    override: {
      editorX: 'forbidden',
      ownerX: 'forbidden',
      ownerY: 'forbidden',
      adminNoMfa: 'forbidden',
      // 2FA sessions reach the verifier, which refuses the wrong code with a
      // ForbiddenError of its own (asserted separately).
      adminMfa: 'forbidden',
      adminStale: 'forbidden',
    },
    prepare: () => ({ data: { code: '000000' } }),
  },
  resetAdminFactorLockoutFn: {
    policy: 'agency-fresh',
    prepare: (w) => ({ data: { userId: w.users.adminStale.id } }),
  },
} satisfies MatrixFor<typeof securityFns>
