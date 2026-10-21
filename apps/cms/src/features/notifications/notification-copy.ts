import type { EventKey, NotificationRole } from '#/lib/notifications'
import { m } from '#/paraglide/messages'

/**
 * Event copy. Kept apart from the pure rule logic so that module stays free of
 * the message runtime. The record is exhaustive, so a new event fails typecheck
 * until it has a label and a description.
 */
const EVENT_COPY: Record<
  EventKey,
  { label: () => string; description: () => string }
> = {
  'release.live': {
    label: () => m.notifications_event_release_live_label(),
    description: () => m.notifications_event_release_live_description(),
  },
  'release.live.others': {
    label: () => m.notifications_event_release_live_others_label(),
    description: () => m.notifications_event_release_live_others_description(),
  },
  'release.failed': {
    label: () => m.notifications_event_release_failed_label(),
    description: () => m.notifications_event_release_failed_description(),
  },
  'release.stuck': {
    label: () => m.notifications_event_release_stuck_label(),
    description: () => m.notifications_event_release_stuck_description(),
  },
  'schedule.published': {
    label: () => m.notifications_event_schedule_published_label(),
    description: () => m.notifications_event_schedule_published_description(),
  },
  'schedule.failed': {
    label: () => m.notifications_event_schedule_failed_label(),
    description: () => m.notifications_event_schedule_failed_description(),
  },
  'rollback.live': {
    label: () => m.notifications_event_rollback_live_label(),
    description: () => m.notifications_event_rollback_live_description(),
  },
  'invite.accepted': {
    label: () => m.notifications_event_invite_accepted_label(),
    description: () => m.notifications_event_invite_accepted_description(),
  },
  'agency.release.failed': {
    label: () => m.notifications_event_agency_release_failed_label(),
    description: () =>
      m.notifications_event_agency_release_failed_description(),
  },
}

export function eventLabel(event: EventKey): string {
  return EVENT_COPY[event].label()
}

export function eventDescription(event: EventKey): string {
  return EVENT_COPY[event].description()
}

export function roleLabel(role: NotificationRole): string {
  if (role === 'owner') return m.admin_role_owner()
  if (role === 'editor') return m.admin_role_editor()
  return m.notifications_role_agency()
}
