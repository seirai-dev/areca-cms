import type * as authMethodsFns from '#/server/fn/auth-methods'

import type { MatrixFor } from './shared'

export const authMethodsRows = {
  getAuthMethodsFn: { policy: 'public' },
} satisfies MatrixFor<typeof authMethodsFns>
