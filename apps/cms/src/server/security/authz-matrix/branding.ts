import type * as brandingFns from '#/server/fn/branding'

import type { MatrixFor } from './shared'

export const brandingRows = {
  getBrandingFn: {
    policy: 'public',
    note: 'Public by design: login/setup/invite pages render the brand before sign-in.',
  },
  updateBrandingFn: {
    policy: 'agency',
    prepare: () => ({ data: { appName: 'Defaced By Caller' } }),
  },
  clearBrandingImageFn: {
    policy: 'agency',
    prepare: () => ({ data: { kind: 'logo' } }),
  },
  resetBrandingFn: { policy: 'agency' },
} satisfies MatrixFor<typeof brandingFns>
