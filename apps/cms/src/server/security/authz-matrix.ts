/**
 * The authorization matrix: every server function in `src/server/fn/*.ts`,
 * the policy its guards are supposed to implement, and a `prepare` that
 * builds a valid payload (plus a side-effect probe) from the seeded world.
 * `authz-matrix.test.ts` runs each row as every actor.
 *
 * The rows live in `authz-matrix/<fn module>.ts`, keyed by export name; a
 * server function without a row does not compile. docs/AUTHZ_MATRIX.md is
 * generated from them (`pnpm --filter @areca/cms authz:doc`).
 */
import * as accountFns from '#/server/fn/account'
import * as activityEntriesFns from '#/server/fn/activity-entries'
import * as adminFns from '#/server/fn/admin'
import * as aiFns from '#/server/fn/ai'
import * as assetsFns from '#/server/fn/assets'
import * as authMethodsFns from '#/server/fn/auth-methods'
import * as brandingFns from '#/server/fn/branding'
import * as contentFns from '#/server/fn/content'
import * as devEnvFns from '#/server/fn/dev-env'
import * as homeFns from '#/server/fn/home'
import * as linkTargetsFns from '#/server/fn/link-targets'
import * as mailFns from '#/server/fn/mail'
import * as mcpKeysFns from '#/server/fn/mcp-keys'
import * as mcpOauthFns from '#/server/fn/mcp-oauth'
import * as meFns from '#/server/fn/me'
import * as notificationsFns from '#/server/fn/notifications'
import * as overviewFns from '#/server/fn/overview'
import * as pausedJobsFns from '#/server/fn/paused-jobs'
import * as peopleFns from '#/server/fn/people'
import * as publishingFns from '#/server/fn/publishing'
import * as securityFns from '#/server/fn/security'
import * as setupFns from '#/server/fn/setup'
import * as translateFns from '#/server/fn/translate'
import * as uploadSessionFns from '#/server/fn/upload-session'

import type { MATRIX_SPECS } from './authz-matrix/specs'
import { matrixEntries } from './authz-matrix/specs'
import type { RowSpec, Prepared } from './authz-matrix/shared'
import type { World } from './authz-harness'

export type Row = Omit<RowSpec, 'prepare'> & {
  name: string
  fn: unknown
  prepare: (w: World) => Promise<Prepared> | Prepared
}

export const ALL_FN_MODULES = {
  account: accountFns,
  'activity-entries': activityEntriesFns,
  admin: adminFns,
  ai: aiFns,
  assets: assetsFns,
  'auth-methods': authMethodsFns,
  branding: brandingFns,
  content: contentFns,
  'dev-env': devEnvFns,
  home: homeFns,
  'link-targets': linkTargetsFns,
  mail: mailFns,
  'mcp-keys': mcpKeysFns,
  'mcp-oauth': mcpOauthFns,
  me: meFns,
  notifications: notificationsFns,
  overview: overviewFns,
  'paused-jobs': pausedJobsFns,
  people: peopleFns,
  publishing: publishingFns,
  security: securityFns,
  setup: setupFns,
  translate: translateFns,
  'upload-session': uploadSessionFns,
} satisfies Record<keyof typeof MATRIX_SPECS, unknown>

export const ROWS: Row[] = matrixEntries().map(
  ({ name, module, key, spec }) => ({
    ...spec,
    name,
    fn: (ALL_FN_MODULES[module] as Record<string, unknown>)[key],
    prepare: spec.prepare ?? (() => ({ data: undefined })),
  }),
)
