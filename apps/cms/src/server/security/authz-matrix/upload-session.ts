import type * as uploadSessionFns from '#/server/fn/upload-session'

import type { MatrixFor } from './shared'

export const uploadSessionRows = {
  getUploadSessionFn: {
    policy: 'public',
    note: 'Bearer-token gated (unguessable upload link from create_asset_upload); an unknown token returns null and reveals nothing.',
    prepare: () => ({ data: { token: 'areca_up_unknown-token' } }),
  },
} satisfies MatrixFor<typeof uploadSessionFns>
