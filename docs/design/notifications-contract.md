# Notifications: implementation contract

Status: implemented. This is the design note written before the feature was built; the code and the [docs site](https://docs.arecacms.com) are the source of truth where they differ.

Parent spec: `docs/design/email-notifications.md` (events, resolution order,
storage). This file pins names and shapes so server, UI and docs work can run
in parallel. Where this file and the spec differ, this file wins.

## Client-safe catalog — `src/lib/notifications.ts` (new, no server imports)

```ts
export const NOTIFICATION_EVENTS = [
  'release.live', 'release.live.others', 'release.failed', 'release.stuck',
  'schedule.published', 'schedule.failed', 'rollback.live',
  'invite.accepted', 'agency.release.failed',
] as const
export type EventKey = (typeof NOTIFICATION_EVENTS)[number]
export type NotificationRole = 'owner' | 'editor' | 'agency'

/** Roles an event can reach and its built-in default. */
export const EVENT_CATALOG: Record<EventKey, { roles: NotificationRole[]; default: boolean }> = {
  'release.live':          { roles: ['owner', 'editor', 'agency'], default: true },
  'release.live.others':   { roles: ['owner'],                     default: false },
  'release.failed':        { roles: ['owner', 'editor', 'agency'], default: true },
  'release.stuck':         { roles: ['owner', 'editor', 'agency'], default: true },
  'schedule.published':    { roles: ['owner', 'editor', 'agency'], default: true },
  'schedule.failed':       { roles: ['owner'],                     default: true },
  'rollback.live':         { roles: ['owner'],                     default: false },
  'invite.accepted':       { roles: ['owner', 'agency'],           default: true },
  'agency.release.failed': { roles: ['agency'],                    default: true },
}
/** Org events shown in org matrices (owner/editor columns only). */
export const ORG_EVENTS: EventKey[]      // every event with owner or editor in roles
/** Events shown under "Agency alerts" (role 'agency'). */
export const AGENCY_EVENTS: EventKey[]   // every event with 'agency' in roles
export function isEventKey(value: string): value is EventKey
/** i18n key stem: 'release.live.others' → 'release_live_others'. */
export function eventMessageStem(event: EventKey): string
```

### Role rule

- A recipient who is a **member** of the org gets org events with their
  membership role (`owner`/`editor`) and preferences keyed by that org.
- A recipient who is **not a member but an agency admin** (e.g. an admin
  requested the release or sent the invite) gets the event with role
  `agency`, preferences keyed by `organizationId = null` (same as
  `agency.*`). Resolution for role `agency` uses agency rules only.
- Anyone else is skipped.
- `agency.release.failed` goes to every agency admin, except admins who
  already got a `release.failed` / `release.stuck` / `schedule.failed`
  notification for the same publication or schedule failure.

## Data (migration `0026_notifications`, generate with drizzle-kit from `apps/cms`)

Tables `notification_rule`, `notification_preference`, `notification` exactly
as in the spec (unique indexes `NULLS NOT DISTINCT`; drizzle:
`.nullsNotDistinct()`). Plus on `publication`:

- `origin text not null default 'manual'` — `'manual' | 'scheduled' | 'rollback'`.
  `requestPublication` sets `'scheduled'` when `isScheduler`, `requestRollback`
  sets `'rollback'`.
- `scheduled_by jsonb not null default '[]'` (`string[]`) — the user ids who
  scheduled the entries (already computed in `requestPublication`).

Retention: `cleanupNotifications()` deletes `notification` rows older than 30
days; called from the same hourly loop as `cleanupOutbox`.

## Server modules (`src/server/notifications/`)

```ts
// events.ts  — re-exports the catalog from #/lib/notifications
// preferences.ts
export type RuleCell = { enabled: boolean; locked: boolean }
export type ResolvedPreference = {
  enabled: boolean
  /** Who forces it on, if anyone. */
  lockedBy: null | 'agency' | 'organization'
  /** Where the value comes from. */
  source: 'agency_lock' | 'organization_lock' | 'user' | 'organization' | 'agency' | 'builtin'
}
/** Pure. Spec order: agency lock → org lock → user → org default → agency default → built-in.
 *  Role 'agency' / agency.* events ignore org rules. */
export function resolvePreference(input: {
  event: EventKey; role: NotificationRole
  agencyRule?: RuleCell | null; orgRule?: RuleCell | null
  userChoice?: boolean | null
}): ResolvedPreference
// plus DB helpers used by notify() and the fns (load rules/preferences, upsert, clear)

// notify.ts
export type NotificationPayload = {
  siteId?: string; siteName?: string; orgName?: string; organizationId?: string
  publicationId?: string
  /** Up to 10, plus a count of the rest. */
  entries?: { title: string; collection: string; change: 'added' | 'updated' | 'removed' }[]
  moreEntries?: number
  actorName?: string | null
  inviteeName?: string; inviteeEmail?: string; role?: string
}
/** Stores one `notification` row per recipient whose preference resolves on
 *  (dedupe_key `${event}:${subjectId}:${userId}`, on conflict do nothing) and
 *  queues an email (template 'notification', kind = event) when the recipient's
 *  email is verified and mail is configured. Never throws: logs `notifications`
 *  component errors. Call after the triggering transaction commits. */
export async function notify(input: {
  event: EventKey
  organizationId: string | null
  /** Publication id, invitation id, … — makes the dedupe key. */
  subjectId: string
  recipients: { userId: string; role: NotificationRole }[]
  payload: NotificationPayload
}): Promise<{ notified: string[] }>   // user ids that got a row

// triggers.ts — what the publishing/invite code calls (all never throw)
export async function notifyPublicationLive(publicationId: string): Promise<void>
  // origin manual → release.live (requester) + release.live.others (other owners)
  // origin scheduled → schedule.published (scheduled_by users)
  // origin rollback → rollback.live (owners) ; requester gets release.live
  // entries = diff vs the previous live/demo publication (diffSnapshotCollections), title = data.title ?? slug
export async function notifyPublicationFailed(publicationId: string, opts: { stuck: boolean }): Promise<void>
  // release.failed | release.stuck → requester + scheduled_by + owners; then agency.release.failed
export async function deliverScheduleFailed(siteId: string, input: { scheduledBy: string[]; fingerprint: string }): Promise<void>  // throws on failure: run by the outbox
  // schedule.failed → owners; then agency.release.failed (subjectId = `schedule:${siteId}:${fingerprint}`)
  // queued by queueScheduleFailedEvent in the same transaction that records the failure (notification_event)
export async function notifyInviteAccepted(invitationId: string, acceptedUserId: string): Promise<void>
  // invite.accepted → inviter

// unsubscribe.ts
/** base64url(JSON {u,o,e,x}) + '.' + base64url(HMAC-SHA256(BETTER_AUTH_SECRET,
 *  'notifications:unsubscribe:' + payload)). x = expiry (unix s), 60 days. timingSafeEqual. */
export function signUnsubscribeToken(input: { userId: string; organizationId: string | null; event: EventKey }, now?: Date): string
export function verifyUnsubscribeToken(token: string, now?: Date):
  | { ok: true; userId: string; organizationId: string | null; event: EventKey }
  | { ok: false; reason: 'invalid' | 'expired' }
/** Sets the user's preference off. Locked → { ok: false, reason: 'locked' }. */
export async function applyUnsubscribe(token: string): Promise<...>
```

### Wiring (each call after commit, wrapped so it can never fail the caller)

- `publishing/worker.ts` success path (after the transaction, next to the
  completion audit) → `notifyPublicationLive(pub.id)`.
- `failJob` (when `recorded`) → `notifyPublicationFailed(publicationId, { stuck: dispatchUncertain })`.
- `recoverStaleJobs` → after the transaction, for each stale job →
  `notifyPublicationFailed(job.publicationId, { stuck: <dispatch uncertain> })`.
- `resolveUncertainDeploymentJob` → after resolving → `notifyPublicationFailed(id, { stuck: false })`
  (dedupe key makes a repeat harmless: use event `release.failed`).
- `scheduler.ts` validation failure → `recordRequestFailure` queues the
  `schedule.failed` event in its own transaction, next to the backoff record;
  the events loop then calls `deliverScheduleFailed`. Thrown errors record the
  backoff without a notice, as before.
- `members.ts` `acceptInvitation` → `notifyInviteAccepted`.

### Email template `notification` (`render/templates/notification.ts`)

- `MailTemplate` gains `'notification'`; stored params `{ userId, notificationId }`.
  Render loads the notification row (payload + event + organizationId) and the
  recipient; missing → `MailRenderError`.
- Subject/heading/body/button per event, all `server_mail_tpl_notify_*`
  messages in en/nl/tr. Go live lists entries ("Added · Blog · Hello world").
  Failure emails do **not** include the raw job error: they say it didn't go
  live and link to Releases.
- Buttons: release/schedule/rollback → `${APP_URL}/sites/${siteId}/releases`;
  invite → `${APP_URL}/sites/${siteId}/people` when a site is known, else
  `${APP_URL}/`; agency alert → `${APP_URL}/agency/clients/${organizationId}`.
- Footer: "You get this because … · Manage notification emails: {APP_URL}/account#notifications".
  Unlocked: plus "Unsubscribe: {APP_URL}/unsubscribe?token=…" and headers
  `List-Unsubscribe: <${APP_URL}/api/notifications/unsubscribe?token=…>`,
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
  Locked: "This email is required by {org|agency}." and no unsubscribe header.
- `RenderedMail` gains `headers?: Record<string, string>`; the outbox passes it
  into `MailMessage.headers`.

## Server functions — `src/server/fn/notifications.ts` (new)

Shared types live in `src/lib/notifications.ts` (client-safe).

```ts
export type PreferenceRow = {
  event: EventKey
  enabled: boolean
  lockedBy: null | 'agency' | 'organization'
}
export type MyNotifications = {
  emailVerified: boolean
  mailConfigured: boolean
  agencyName: string                       // branding appName
  orgs: { organizationId: string; orgName: string; role: 'owner' | 'editor'; events: PreferenceRow[] }[]
  /** Agency admins only: role 'agency' events (incl. agency.release.failed). */
  agency: { events: PreferenceRow[] } | null
}
export type MatrixCell = {
  enabled: boolean
  locked: boolean
  /** Set at this scope (false = inherited from the level above / built-in). */
  overridden: boolean
  /** Org matrix only: agency locked it, read-only here. */
  lockedAbove: boolean
}
export type RulesMatrix = {
  rows: { event: EventKey; cells: Partial<Record<NotificationRole, MatrixCell>> }[]
}
```

| Fn | Method | Guard | Input | Output |
|---|---|---|---|---|
| `getMyNotificationsFn` | GET | signed in | — | `MyNotifications` |
| `setMyNotificationFn` | POST | signed in; member of org (or agency admin for `null`) | `{ organizationId: string \| null, event, enabled }` | `{ ok: true } \| { ok: false, message }` (locked → message) |
| `getOrgNotificationRulesFn` | GET | org owner or agency admin | `{ organizationId }` | `RulesMatrix & { orgName: string; agencyName: string }` (columns owner, editor) |
| `setOrgNotificationRuleFn` | POST | org owner or agency admin | `{ organizationId, event, role: 'owner'\|'editor', enabled, locked } \| { organizationId, event, role, clear: true }` | `RulesMatrix` (agency-locked cell → error) |
| `getAgencyNotificationRulesFn` | GET | agency admin | — | `{ clients: RulesMatrix; agency: RulesMatrix }` (clients: owner/editor columns of ORG_EVENTS; agency: 'agency' column of AGENCY_EVENTS) |
| `setAgencyNotificationRuleFn` | POST | agency admin | `{ event, role, enabled, locked } \| { event, role, clear: true }` | same as get |
| `getUnsubscribeFn` | GET | public | `{ token }` | `{ status: 'ok' \| 'already_off' \| 'locked' \| 'invalid' \| 'expired', eventLabel?: string, orgName?: string \| null }` |
| `confirmUnsubscribeFn` | POST | public | `{ token }` | `{ ok: true } \| { ok: false, message }` |

Rule/preference changes are audited (`notification_rule.update`, organization id
or null). Every fn gets a row in `src/server/security/authz-matrix.ts`.

API route `src/routes/api/notifications.unsubscribe.ts`: `POST ?token=` (RFC
8058 one-click) → `applyUnsubscribe`, 200 `{ ok }` / 400. No GET.

## UI

All copy in `messages/{en,nl,tr}.json` with `notifications_*` keys (server
template keys are `server_mail_tpl_notify_*`; event labels
`notifications_event_<stem>_label` / `_description`, owned by the UI task).
Reuse `SettingsSection`, `InsetList`, `Switch`, `Tooltip`, `QueryError`,
`sonner`; Phosphor icons (`LockSimple`, `LockSimpleOpen`).

- `src/features/notifications/notification-rules-matrix.tsx`: rows = events
  (label + one-line description), columns = roles. Cell = Switch + lock toggle
  (icon button, `aria-pressed`, tooltip "Required: members can't turn it off").
  Locked-above cells disabled with "Required by {agency}". Overridden cells show
  a small "Reset" (clear). On phones the columns stack per event. Test ids
  `rules-matrix`, `rule-{event}-{role}-switch`, `rule-{event}-{role}-lock`.
- **Account → Notifications** (`id="notifications"` for the `#notifications`
  anchor; after Email language): one group per org ("{org} · Owner"), switches
  per event; locked rows disabled with "Required by {org}" / "Required by {agency}".
  Agency admins also get "Agency alerts". Notices: unverified email ("Verify your
  email to get notification emails"), mail not configured. Test ids
  `notif-{orgId|agency}-{event}`.
- **Agency → Mail**: new sections "Default notifications for clients"
  (clients matrix) and "Agency alerts" (agency matrix), between the mail server
  section and Recent emails. Saved per change (toast on error), not via the
  floating bar.
- **Agency → Clients → {org} → Settings**: section "Notifications" with the org
  matrix, "Applies to every site in {org}".
- **Site → People** (owners + admins, `canManageSite`): the same org section
  below the people list.
- **`/unsubscribe?token=`** (public, inside `AuthShell`): "Turn off {event}
  emails for {org}?" + accent button → success "Done. You won't get these
  emails any more." + link "Manage notification emails" → `/account#notifications`.
  Invalid/expired/locked/already off states.

## Tests

- Unit: `resolvePreference` (every level, locks, agency role ignores org),
  catalog helpers, unsubscribe sign/verify/expiry/tamper, template rendering
  for every event in en/nl/tr with headers.
- DB: `notify` fan-out (prefs, locks, verified-only email, mail not configured,
  dedupe), triggers (manual/scheduled/rollback live, failed/stuck, agency
  alert dedupe, invite accepted, non-member admin → role agency), fns
  (guards, locked rejection), unsubscribe apply, cleanup.
- E2E: account toggles incl. a locked one; agency defaults lock; org rules on
  Clients → Settings; unsubscribe page.
