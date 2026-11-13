import type { BuildJobStatus, PublicationStatus } from '#/lib/types'
import { m } from '#/paraglide/messages'

/**
 * The one place that maps every status in the product to its label, tone and
 * icon (brief §1.2, §3.6). Pills, filters, the tray, the timeline and the
 * editor all read from here, so the vocabulary never drifts.
 */

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error'

export type StatusIconKind =
  | 'pencil'
  | 'dot'
  | 'live'
  | 'clock'
  | 'box'
  | 'spinner'
  | 'queued'
  | 'check'
  | 'failed'
  | 'cancelled'
  | 'replaced'
  | 'restore'

type StatusMeta = {
  label: () => string
  tone: StatusTone
  icon: StatusIconKind
}

/** UI entry status (brief §1.2): Draft → Ready → Live, plus Scheduled/Archived. */
export type EntryUiStatus =
  'draft' | 'ready' | 'live' | 'scheduled' | 'archived'

export const ENTRY_STATUS: Record<
  EntryUiStatus,
  StatusMeta & { long: () => string }
> = {
  draft: {
    label: () => m.shell_status_draft(),
    long: () => m.shell_status_draft(),
    tone: 'neutral',
    icon: 'pencil',
  },
  ready: {
    label: () => m.shell_status_ready(),
    long: () => m.shell_status_ready_long(),
    tone: 'accent',
    icon: 'dot',
  },
  live: {
    label: () => m.shell_status_live(),
    long: () => m.shell_status_live(),
    tone: 'success',
    icon: 'live',
  },
  scheduled: {
    label: () => m.shell_status_scheduled(),
    long: () => m.shell_status_scheduled(),
    tone: 'warning',
    icon: 'clock',
  },
  archived: {
    label: () => m.shell_status_archived(),
    long: () => m.shell_status_archived(),
    tone: 'neutral',
    icon: 'box',
  },
}

export const PUBLICATION_STATUS: Record<
  PublicationStatus,
  StatusMeta & { title: () => string }
> = {
  demo: {
    label: () => m.golive_demo_ready(),
    title: () => m.golive_title_demo(),
    tone: 'warning',
    icon: 'box',
  },
  pending: {
    label: () => m.golive_pub_pending(),
    title: () => m.golive_title_pending(),
    tone: 'neutral',
    icon: 'queued',
  },
  building: {
    label: () => m.golive_pub_building(),
    title: () => m.golive_title_building(),
    tone: 'accent',
    icon: 'spinner',
  },
  live: {
    label: () => m.golive_pub_live(),
    title: () => m.golive_title_live(),
    tone: 'success',
    icon: 'live',
  },
  failed: {
    label: () => m.golive_pub_failed(),
    title: () => m.golive_title_failed(),
    tone: 'error',
    icon: 'failed',
  },
  superseded: {
    label: () => m.golive_pub_superseded(),
    title: () => m.golive_title_superseded(),
    tone: 'neutral',
    icon: 'replaced',
  },
  rolled_back: {
    label: () => m.golive_pub_rolled_back(),
    title: () => m.golive_title_rolled_back(),
    tone: 'neutral',
    icon: 'restore',
  },
}

export const JOB_STATUS: Record<BuildJobStatus, StatusMeta> = {
  queued: {
    label: () => m.golive_job_queued(),
    tone: 'neutral',
    icon: 'queued',
  },
  building: {
    label: () => m.golive_job_building(),
    tone: 'accent',
    icon: 'spinner',
  },
  validating: {
    label: () => m.golive_job_validating(),
    tone: 'accent',
    icon: 'spinner',
  },
  deploying: {
    label: () => m.golive_job_deploying(),
    tone: 'accent',
    icon: 'spinner',
  },
  succeeded: {
    label: () => m.golive_job_succeeded(),
    tone: 'success',
    icon: 'check',
  },
  failed: {
    label: () => m.golive_job_failed(),
    tone: 'error',
    icon: 'failed',
  },
  cancelled: {
    label: () => m.golive_job_cancelled(),
    tone: 'neutral',
    icon: 'cancelled',
  },
}

/** Steps shown while going live, in order. */
export const GO_LIVE_STEPS: readonly BuildJobStatus[] = [
  'queued',
  'building',
  'validating',
  'deploying',
]

export { isActiveJobStatus } from '#/lib/job-status'
