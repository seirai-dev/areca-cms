import type * as mailFns from '#/server/fn/mail'

import { unreachableMailDraft } from './shared'
import type { MatrixFor } from './shared'

export const mailRows = {
  getMailSettingsFn: {
    policy: 'agency',
    note: 'Never contains the SMTP password, only whether one is stored.',
  },
  verifyMailDraftFn: {
    policy: 'agency',
    note: 'Allowed callers get a readable connection failure (nothing listens on port 1).',
    prepare: () => ({ data: unreachableMailDraft() }),
  },
  sendTestEmailFn: {
    policy: 'agency',
    note: 'Sends only to the caller; allowed callers get a readable failure.',
    prepare: () => ({ data: unreachableMailDraft() }),
  },
  saveMailSettingsFn: {
    policy: 'agency-fresh',
    note: 'Without force, an unverifiable draft is not saved, so the shared test database keeps its mail source.',
    prepare: () => ({ data: { ...unreachableMailDraft(), force: false } }),
  },
  useEnvironmentMailFn: { policy: 'agency-fresh' },
  listRecentEmailsFn: {
    policy: 'agency',
    prepare: () => ({ data: {} }),
  },
  getMailHealthFn: { policy: 'agency' },
} satisfies MatrixFor<typeof mailFns>
