import { accountRows } from './account'
import { activityEntriesRows } from './activity-entries'
import { adminRows } from './admin'
import { aiRows } from './ai'
import { assetsRows } from './assets'
import { authMethodsRows } from './auth-methods'
import { brandingRows } from './branding'
import { contentRows } from './content'
import { devEnvRows } from './dev-env'
import { homeRows } from './home'
import { linkTargetsRows } from './link-targets'
import { mailRows } from './mail'
import { mcpKeysRows } from './mcp-keys'
import { mcpOauthRows } from './mcp-oauth'
import { meRows } from './me'
import { notificationsRows } from './notifications'
import { overviewRows } from './overview'
import { pausedJobsRows } from './paused-jobs'
import { peopleRows } from './people'
import { publishingRows } from './publishing'
import { securityRows } from './security'
import { setupRows } from './setup'
import { translateRows } from './translate'
import { uploadSessionRows } from './upload-session'
import type { RowSpec } from './shared'

/** Matrix rows per `src/server/fn` module, keyed by file name. */
export const MATRIX_SPECS = {
  account: accountRows,
  'activity-entries': activityEntriesRows,
  admin: adminRows,
  ai: aiRows,
  assets: assetsRows,
  'auth-methods': authMethodsRows,
  branding: brandingRows,
  content: contentRows,
  'dev-env': devEnvRows,
  home: homeRows,
  'link-targets': linkTargetsRows,
  mail: mailRows,
  'mcp-keys': mcpKeysRows,
  'mcp-oauth': mcpOauthRows,
  me: meRows,
  notifications: notificationsRows,
  overview: overviewRows,
  'paused-jobs': pausedJobsRows,
  people: peopleRows,
  publishing: publishingRows,
  security: securityRows,
  setup: setupRows,
  translate: translateRows,
  'upload-session': uploadSessionRows,
}

export type MatrixEntry = {
  /** Test and doc name: the export name, plus the variant in parentheses. */
  name: string
  /** File name of the fn module, without `.ts`. */
  module: keyof typeof MATRIX_SPECS
  /** Export name of the server fn. */
  key: string
  spec: RowSpec
}

export function matrixEntries(): MatrixEntry[] {
  return Object.entries(MATRIX_SPECS).flatMap(([module, rows]) =>
    Object.entries(
      rows as Record<string, RowSpec | readonly RowSpec[]>,
    ).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).map((spec: RowSpec) => ({
        name: spec.variant ? `${key} (${spec.variant})` : key,
        module: module as keyof typeof MATRIX_SPECS,
        key,
        spec,
      })),
    ),
  )
}
