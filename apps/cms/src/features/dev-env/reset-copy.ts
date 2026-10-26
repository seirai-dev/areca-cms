import { m } from '#/paraglide/messages'

import { pluralForm } from './push-model'

/**
 * The reset confirm's copy. It says how many unpushed changes the reset throws
 * away (docs/design/dev-environments.md, Decision 6).
 */
export function resetDevEnvDescription(unpushed: number): string {
  if (unpushed === 0) return m.dev_env_reset_description()
  return pluralForm(unpushed) === 'one'
    ? m.dev_env_reset_description_unpushed_one()
    : m.dev_env_reset_description_unpushed_other({ count: unpushed })
}
