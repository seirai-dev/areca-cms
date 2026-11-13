import type * as setupFns from '#/server/fn/setup'

import { uniq } from './shared'
import type { MatrixFor } from './shared'

export const setupRows = {
  getSetupStatusFn: { policy: 'public' },
  completeSetupFn: {
    policy: 'public',
    note: 'Open endpoint by design but token-gated: a wrong setup token is refused for everyone, signed in or not.',
    override: {
      anonymous: 'forbidden',
      editorX: 'forbidden',
      ownerX: 'forbidden',
      ownerY: 'forbidden',
      adminNoMfa: 'forbidden',
      adminMfa: 'forbidden',
      adminStale: 'forbidden',
    },
    prepare: () => ({
      data: {
        name: 'Intruder',
        email: `intruder-${uniq()}@authz.test`,
        password: 'correct horse battery',
        setupToken: 'definitely-not-the-setup-token',
      },
    }),
  },
} satisfies MatrixFor<typeof setupFns>
