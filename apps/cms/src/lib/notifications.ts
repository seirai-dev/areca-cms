/**
 * Notification events, roles and built-in defaults. Client-safe: the
 * preference screens and the server share it. See
 * docs/design/notifications-contract.md.
 */
export const NOTIFICATION_EVENTS = [
  'release.live',
  'release.live.others',
  'release.failed',
  'release.stuck',
  'schedule.published',
  'schedule.failed',
  'rollback.live',
  'invite.accepted',
  'agency.release.failed',
] as const

export type EventKey = (typeof NOTIFICATION_EVENTS)[number]

export type NotificationRole = 'owner' | 'editor' | 'agency'

export type EventCatalogEntry = {
  /** Roles the event can reach. */
  roles: NotificationRole[]
  /** Built-in default when no rule or choice applies. */
  default: boolean
}

export const EVENT_CATALOG: Record<EventKey, EventCatalogEntry> = {
  'release.live': { roles: ['owner', 'editor', 'agency'], default: true },
  'release.live.others': { roles: ['owner'], default: false },
  'release.failed': { roles: ['owner', 'editor', 'agency'], default: true },
  'release.stuck': { roles: ['owner', 'editor', 'agency'], default: true },
  'schedule.published': { roles: ['owner', 'editor', 'agency'], default: true },
  'schedule.failed': { roles: ['owner'], default: true },
  'rollback.live': { roles: ['owner'], default: false },
  'invite.accepted': { roles: ['owner', 'agency'], default: true },
  'agency.release.failed': { roles: ['agency'], default: true },
}

/** Events shown in org matrices (owner and editor columns). */
export const ORG_EVENTS: EventKey[] = NOTIFICATION_EVENTS.filter((event) =>
  EVENT_CATALOG[event].roles.some((role) => role !== 'agency'),
)

/** Events shown under "Agency alerts" (the agency role). */
export const AGENCY_EVENTS: EventKey[] = NOTIFICATION_EVENTS.filter((event) =>
  EVENT_CATALOG[event].roles.includes('agency'),
)

export function isEventKey(value: string): value is EventKey {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(value)
}

/** i18n key stem: 'release.live.others' → 'release_live_others'. */
export function eventMessageStem(event: EventKey): string {
  return event.replace(/\./g, '_')
}

/** True when the role can receive the event at all. */
export function eventReachesRole(event: EventKey, role: NotificationRole) {
  return EVENT_CATALOG[event].roles.includes(role)
}

/** A user's resolved setting for one event. */
export type PreferenceRow = {
  event: EventKey
  enabled: boolean
  /** Who forces it on, if anyone. */
  lockedBy: null | 'agency' | 'organization'
}

/** Account → Notifications. */
export type MyNotifications = {
  emailVerified: boolean
  mailConfigured: boolean
  /** Branding app name, for "Required by {agency}". */
  agencyName: string
  orgs: {
    organizationId: string
    orgName: string
    role: 'owner' | 'editor'
    events: PreferenceRow[]
  }[]
  /** Agency admins only: the agency-role events. */
  agency: { events: PreferenceRow[] } | null
}

export type MatrixCell = {
  enabled: boolean
  locked: boolean
  /** Set at this scope; false means inherited from above or built in. */
  overridden: boolean
  /** Org matrix only: the agency locked it, so it's read-only here. */
  lockedAbove: boolean
}

export type RulesMatrix = {
  rows: {
    event: EventKey
    cells: Partial<Record<NotificationRole, MatrixCell>>
  }[]
}

export type UnsubscribeStatus =
  'ok' | 'already_off' | 'locked' | 'invalid' | 'expired'

export type NotificationEntryChange = 'added' | 'updated' | 'removed'

/** What a notification row stores so its email (and later an inbox) can render. */
export type NotificationPayload = {
  siteId?: string
  siteName?: string
  orgName?: string
  organizationId?: string
  publicationId?: string
  /** Up to 10, plus a count of the rest. */
  entries?: {
    title: string
    collection: string
    change: NotificationEntryChange
  }[]
  moreEntries?: number
  actorName?: string | null
  inviteeName?: string
  inviteeEmail?: string
  /** Membership role of the invitee (`owner` | `editor`). */
  role?: string
  /** Set per recipient when the row is created. */
  recipientRole?: NotificationRole
  /** Set per recipient: who forces the email on, if anyone. */
  lockedBy?: null | 'agency' | 'organization'
}
