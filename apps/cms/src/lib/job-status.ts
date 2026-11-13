import type { BuildJobStatus } from '#/lib/types'

/** A worker holds the job: claimed and not finished. */
export const RUNNING_JOB_STATUSES = [
  'building',
  'validating',
  'deploying',
] as const satisfies readonly BuildJobStatus[]

/** Not finished: waiting for a worker or running. */
export const ACTIVE_JOB_STATUSES = [
  'queued',
  ...RUNNING_JOB_STATUSES,
] as const satisfies readonly BuildJobStatus[]

/** `RUNNING_JOB_STATUSES` as a raw SQL list, for `status IN (...)`. */
export const RUNNING_JOB_STATUSES_SQL = RUNNING_JOB_STATUSES.map(
  (status) => `'${status}'`,
).join(',')

export function isActiveJobStatus(status: BuildJobStatus) {
  return (ACTIVE_JOB_STATUSES as readonly BuildJobStatus[]).includes(status)
}
