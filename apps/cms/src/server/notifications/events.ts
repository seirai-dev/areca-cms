/**
 * Server-side view of the notification catalog. The definitions live in the
 * client-safe `#/lib/notifications` so the preference screens share them.
 */
export {
  AGENCY_EVENTS,
  EVENT_CATALOG,
  NOTIFICATION_EVENTS,
  ORG_EVENTS,
  eventMessageStem,
  eventReachesRole,
  isEventKey,
} from '#/lib/notifications'
export type {
  EventKey,
  NotificationRole,
  PreferenceRow,
} from '#/lib/notifications'
