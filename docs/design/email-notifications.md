# Email and notifications

Status: agreed 21 Oct 2026. This is the contract every PR implements.

## What it is

The CMS sends email through any SMTP provider. The provider can be changed
while the app runs from **Agency → Mail**. Account emails (password reset,
verification, invites, security notices) always send. Notification emails
(go live, scheduled publish, deploy failures, invite accepted) are
configurable per user, with defaults set by the agency and by each client
org, and locks that make an email required. Every event goes through one
`notify()` call that stores a notification row per recipient, so an in-app
notification centre can be added later on top of the same rows.

## Decisions (user, 21 Oct 2026)

| Topic | Decision |
|---|---|
| Account emails | Invitation, password reset, email verification, password changed, two-factor turned on/off, removed from org / role changed. **Always on**, not in preferences. |
| Delivery | Postgres outbox + retry worker. 3 attempts over ~15 min (1 min, 5 min, 10 min), then `failed`. User-triggered sends (invite, resend, reset, test) also try **immediately** in the request so the user sees the result. |
| SMTP source | Mail tab settings replace `.env` SMTP **entirely** (no field merge). Switch "Use environment settings" returns to env. UI shows "Sending with: Mail settings / Environment". |
| SMTP security | Encryption: `starttls` (required, e.g. 587), `tls` (implicit, e.g. 465), `none` (only for localhost / private network hosts). Certificates always verified. Auth user + password optional. Connection, greeting and socket timeouts 15 s. |
| Password storage | AES-256-GCM via `server/security/secret-encryption.ts`, context `mail-settings:smtp-password`. Key `SECRETS_ENCRYPTION_KEY`, falling back to `AI_SETTINGS_ENCRYPTION_KEY`. Without a key the password field is disabled with an explanation. Password never returned to the browser (`passwordSet: boolean`). |
| Verify + test | **Verify connection** (SMTP handshake + auth) and **Send test email** (to the current admin) work on the unsaved form values. Save requires a successful verify unless the admin picks **Save anyway**. |
| Step-up | Saving mail settings requires the same step-up as Agency → AI. Changes are audited (`mail_settings.update`, `mail_settings.use_env`), never with secrets. |
| Env | `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` become **optional**. New optional: `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` (`starttls`/`tls`/`none`, default `starttls`, or `none` when host is localhost/private), `SMTP_REPLY_TO`, `SECRETS_ENCRYPTION_KEY`. When neither env nor Mail tab is configured, sending is off: agency admins see a "Mail isn't set up" banner, invites still work via Copy link, forgot password says to ask an admin. |
| Scope | One mail config for the whole install. No per-org SMTP. Sender name per install via Branding. |
| Channel | Email only. No bell/inbox now, but `notification` rows are stored for it. |
| Unsubscribe | Notification emails (not account emails) carry a footer link and `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The link turns that event off for that user in that org and opens their preferences. Locked events show "required" instead of an unsubscribe link. |
| Look | One shared HTML layout + plain-text part. Uses agency **branding**: app name, logo (absolute URL), accent colour (button), font (with web-safe fallback), sender name. Quiet: logo, white card, one button, small footer. Dark-mode safe. Copy not editable in UI. |
| Language | New `user.locale` (`en`/`nl`/`tr`, nullable). Set from the interface language on invite acceptance / setup / sign-in when empty, editable in Account. Emails render in the recipient's locale, else `en`. All strings in `messages/{en,nl,tr}.json`. |
| Review flow | **Out of scope.** No review events. |
| Batching | One email per event. Go live email lists the entries it shipped. No digests. |
| Verification | Invite acceptance via emailed link marks `emailVerified = true`. SSO sign-ins trusted. First `/setup` admin gets a verification email once mail works plus a dismissible "Verify your email" banner (non-blocking). Notification emails only to verified addresses; account emails to everyone. Email change: out of scope. |
| Password reset | "Forgot password?" on login. Same response whether or not the account exists. Link valid 1 h, single use, revokes all sessions on success. 2FA still required at next sign-in. 3 requests / hour per email and per IP. SSO-only users get "You sign in with Microsoft/Google" instead of a link. Agency admins: **Send reset link** on a person in Agency → People. |
| Errors | Nodemailer/SMTP errors map to plain sentences (see below). Shown as toasts for user-triggered sends, per row in Recent emails and on invites, and a banner for agency admins after 3 consecutive failures. Logged as structured `mail` component entries, redacted. |
| Retention | Notification and delivery rows kept 30 days; no email bodies stored. |
| Delivery plan | Stacked PRs: (1) mail foundation, (2) account emails, (3) notifications. |

## Events

`EventKey` is a string union in `src/server/notifications/events.ts`.
Recipient roles: `owner`, `editor` (org members), `agency` (agency admins).

| Key | Trigger (server) | Recipients | Default |
|---|---|---|---|
| `release.live` | worker success path (`publishing/worker.ts`, publication → live) | the requester (`publication.requestedBy`) | on |
| `release.live.others` | same | other owners of the org | off |
| `release.failed` | `failJob`, stale recovery failure, uncertain dispatch resolved as failed | requester + owners | on |
| `release.stuck` | job left `dispatch_uncertain` / `building` past the wait window | requester + owners | on |
| `schedule.published` | scheduler tick → publication live for a `scheduled` note | the user who scheduled the entries | on |
| `schedule.failed` | `publication.scheduled_failed` path | owners | on |
| `rollback.live` | rollback publication goes live | owners | off |
| `invite.accepted` | `acceptInvitation` | the inviter | on |
| `agency.release.failed` | any `release.failed` / `release.stuck` / `schedule.failed`, any org | agency admins | on |

Agency admins who are also members of an org receive the org events under the
org's rules and the `agency.*` events under the agency rules. They never get
two emails for the same publication failure: `agency.release.failed` is
skipped for an admin who already gets `release.failed` for it.

Account emails are not `EventKey`s. They are sent with `sendAccountEmail()`
and kinds: `invitation`, `password_reset`, `verify_email`,
`password_changed`, `two_factor_enabled`, `two_factor_disabled`,
`membership_removed`, `membership_role_changed`.

## Preference resolution

For a (user, org, event, role):

1. If a lock exists at agency level for (event, role) → **on** (required).
2. Else if a lock exists at org level for (event, role) → **on** (required).
3. Else if the user has a choice for (org, event) → that.
4. Else org default for (event, role) if set.
5. Else agency default for (event, role) if set.
6. Else built-in default from the events table.

`agency.*` events use only agency defaults/locks + the user's global choice
(`organizationId = null`). Pure function `resolvePreference()` in
`src/server/notifications/preferences.ts`, fully unit-tested.

A lock means "always on". There is no "locked off"; an owner turns an event
off for the org by setting the org default to off (users can still opt in).

## Storage

```ts
// singleton id 'default'
mail_settings {
  id text pk
  enabled boolean not null default false   // false = use environment
  host text, port integer, secure text     // 'starttls' | 'tls' | 'none'
  username text, encrypted_password text
  from_address text, reply_to text
  last_verified_at timestamptz
  updated_by text → user, updated_at
}

notification_rule {          // defaults and locks
  id text pk
  scope text not null        // 'agency' | 'organization'
  organization_id text → organization (null for agency), cascade
  event text not null
  role text not null         // 'owner' | 'editor' | 'agency'
  enabled boolean not null
  locked boolean not null default false
  updated_by, updated_at
  unique (scope, organization_id, event, role)  -- nulls not distinct
}

notification_preference {    // user choices
  user_id text → user cascade
  organization_id text → organization cascade (null = agency events)
  event text not null
  enabled boolean not null
  updated_at
  unique (user_id, organization_id, event)  -- nulls not distinct
}

notification {               // one per recipient per event; future inbox
  id text pk
  user_id text → user cascade
  organization_id, site_id (nullable)
  event text not null
  payload jsonb not null     // ids + display strings needed to render
  dedupe_key text            // e.g. `${event}:${publicationId}:${userId}`
  read_at timestamptz        // unused for now
  created_at
  unique (dedupe_key)
}

email_outbox {
  id text pk
  kind text not null         // account kind or event key, or 'test'
  to_address text not null
  user_id text null, organization_id null, notification_id null
  subject text not null      // rendered at enqueue time, for the log
  template text not null, params jsonb not null, locale text not null
  status text not null       // 'queued' | 'sending' | 'sent' | 'failed'
  attempts integer default 0, next_attempt_at timestamptz
  lease_until timestamptz
  last_error_code text, last_error text     // readable, redacted
  provider_message_id text, sent_at timestamptz, created_at
  index (status, next_attempt_at)
}

user.locale text null
```

Secret params (reset links, invite tokens) are **not** stored in
`email_outbox.params` in plain text: store the row id the link is derived
from (e.g. `invitationId`), and re-derive or decrypt at send time. Reset
tokens are encrypted with `SECRETS_ENCRYPTION_KEY` (context
`email-outbox:params`) when a key exists. Without a key, the reset email is
sent immediately only (no retry) and the outbox row keeps no token.

Retention: rows in `notification` and `email_outbox` older than 30 days are
deleted by the worker cleanup loop.

## Modules

```
src/server/mail/
  config.ts       resolveMailConfig(): env or DB → MailConfig | null (cached, invalidated on save)
  transport.ts    createTransport(config) with TLS rules + timeouts; verify(); send()
  errors.ts       toMailError(err, ctx) → { code, message (i18n key + params), detail }
  outbox.ts       enqueueEmail(), sendNow(id), claimBatch(), processOutbox(), cleanup
  render/         layout.ts (branded HTML + text), templates/*.ts (one per kind)
  settings.ts     get/save/useEnv/verifyDraft/sendTestDraft (server logic)
src/server/notifications/
  events.ts       EventKey union, catalog (roles, defaults, i18n labels)
  preferences.ts  resolvePreference(), rules + preference CRUD
  notify.ts       notify(event, ctx): resolve recipients → notification rows → outbox
  unsubscribe.ts  signed tokens (HMAC with BETTER_AUTH_SECRET) + handler
src/server/fn/mail.ts, src/server/fn/notifications.ts   server functions
src/routes/_app/agency/mail.tsx
src/routes/unsubscribe.$token.tsx  (or api route + redirect)
src/features/agency/mail-settings-screen.tsx (+ use-mail-settings.ts)
src/features/notifications/*  (preference matrix, shared by account / org / agency)
```

`src/adapters/email/index.ts` (`sendEmail`) is replaced by `server/mail`;
keep `formatFrom` there or move it with its tests.

Outbox worker loop runs inside `startWorkerLoops` (`publishing/worker.ts`)
every 5 s, claims with `FOR UPDATE SKIP LOCKED`, lease 60 s, paces sends at
5/s. Retry delays: attempt 1 → +1 min, 2 → +5 min, 3 → failed (total ~15
min with the immediate try counting as attempt 1 for user-triggered sends).
Non-retryable errors (auth rejected, recipient rejected 5xx, no config) fail
immediately.

## Error messages

`toMailError` returns a code and an i18n message. Codes and English copy:

| Code | When | Message |
|---|---|---|
| `not_configured` | no env and no Mail settings | Mail isn't set up. An agency admin can add a mail server in Agency → Mail. |
| `auth_failed` | `EAUTH`, 535 | The mail server rejected the username or password. Check them in Agency → Mail. |
| `connection_failed` | `ECONNECTION`, `ECONNREFUSED`, `ENOTFOUND`, `EDNS` | Couldn't reach {host} on port {port}. Check the host and port, and that no firewall blocks it. |
| `timeout` | `ETIMEDOUT`, socket/greeting timeout | {host} didn't answer within 15 seconds. Check the host and port, or try again later. |
| `tls_failed` | cert errors, `ESOCKET` with TLS reason, wrong-version-number | The secure connection to {host} failed: {reason}. Check the encryption setting (TLS for port 465, STARTTLS for 587). |
| `starttls_unsupported` | server lacks STARTTLS while required | {host} doesn't support STARTTLS. Choose TLS or another port. |
| `sender_rejected` | 550/553 on MAIL FROM | The mail server doesn't allow sending from {from}. Use an address your provider has verified. |
| `recipient_rejected` | 550/551/553 on RCPT TO | The mail server refused to deliver to {to}: {reply} |
| `rate_limited` | 421/450/451/452, "too many" | The mail server is limiting how fast we send. We'll try again shortly. |
| `unknown` | anything else | Sending failed: {reply}. See the server logs for details (search for outbox id {id}). |

`{reply}` is the SMTP response line, redacted and cut to 200 chars. The log
entry (`createLogger('mail')`) carries `code`, `smtpCode`, `command`,
`response`, `host`, `port`, `secure`, `outboxId`, `kind`, `attempt` and the
redacted `err`. Credentials, tokens and links are redacted
(`redactError` with the SMTP password + link tokens).

## UI

All copy in en/nl/tr. Reuse `SettingsSection`, `InsetList`, `FormField`,
`PageHeader`, `FloatingBar`, `QueryError`, `sonner`. Model the Mail tab on
`features/agency/ai-settings-screen.tsx`.

**Agency → Mail** (`/agency/mail`, nav item after Branding / AI):
1. *Mail server*: status line ("Sending with Mail settings" / "Sending with
   environment settings" / "Mail isn't set up"), switch "Use environment
   settings" (shows env values read-only, password as "Set"/"Not set"),
   fields host, port, encryption (select), username, password (write-only,
   "Leave empty to keep the current password"), From address, Reply-to.
   Buttons **Verify connection**, **Send test email**; save via the floating
   bar, with **Save anyway** in a confirm when verify hasn't passed.
2. *Default notifications for clients*: preference matrix (events × owner /
   editor) with on/off + lock per cell. Plus agency-admin alerts (event ×
   agency).
3. *Recent emails*: last 50 outbox rows: time, recipient, kind (human
   label), status chip, attempts; failed/retrying rows show the readable
   error inline; filter All / Failed. Status timeline per row
   (queued → retrying → sent / failed).

**Account → Notifications**: per org the user belongs to, the event list
with switches; locked events disabled with "Required by {org}" / "Required
by {agency}". Agency admins also see "Agency alerts". Plus **Email
language** select (en/nl/tr).

**Site → Settings → Notifications** (owners + agency admins): org-wide
matrix (events × owner/editor, on/off + lock), labelled "Applies to every
site in {org}". Agency-locked cells read-only. Same component on Agency →
Clients → {org}.

**Login → Forgot password?** → `/forgot-password` (email field, same
success message always) → email → `/reset-password?token=` (new password,
confirm). **Agency → People** row action **Send reset link**.

**Banners**: "Mail isn't set up" (agency admins, when no config), "Emails are
failing" (agency admins, 3+ consecutive failures, links to Recent emails),
"Verify your email" (unverified users, dismissible).

## Tests

- Unit: `resolvePreference` matrix incl. locks; `toMailError` for every
  code; config resolution env vs DB vs none; TLS rule (`none` rejected for
  public hosts); encryption round-trip; `formatFrom`/headers incl.
  `List-Unsubscribe`; unsubscribe token sign/verify/expiry; template
  rendering in en/nl/tr with branding.
- Integration (Postgres + Mailpit): outbox enqueue → send → `sent`; retry
  and backoff on a failing transport; non-retryable fail; invite resend;
  password reset end to end (request, email in Mailpit, reset, sessions
  revoked); `notify` fan-out with prefs/locks/dedupe; settings save
  encrypts and never returns the password.
- E2E (Playwright): Mail tab verify/test/save/use env; forgot password
  flow via Mailpit; account notification toggles incl. a locked one; org
  rules tab.

## Docs

`apps/docs/content/docs/self-hosting/storage-and-email.mdx` and
`configuration.mdx`: new env vars, Mail tab, provider examples (Resend,
Postmark, Amazon SES, Mailgun, Gmail/Workspace), SPF/DKIM/DMARC, what each
role receives. `apps/docs/content/docs/cms/`: notifications page (users,
owners), Agency → Mail page, password reset. `docs/CONFIGURATION.md`,
`docs/INTEGRATIONS.md`, `apps/cms/.env.example`.

## PRs

1. **Mail foundation** (`feature/mail-foundation` from `main`): env
   changes, `mail_settings`, `email_outbox`, `server/mail/*`, outbox loop,
   errors + logging, branded layout, invites moved onto the outbox, Agency
   → Mail tab (server + Recent emails), banners for not-set-up/failing,
   docs for setup.
2. **Account emails** (`feature/account-emails` on 1): `user.locale`,
   password reset (+ admin Send reset link), verification + banner, security
   notices (password changed, 2FA on/off, removed/role changed), Account →
   Email language.
3. **Notifications** (`feature/notifications` on 2): `notification_rule`,
   `notification_preference`, `notification`, events + `notify()` wired
   into worker/scheduler/invites, unsubscribe, preference UI in Account,
   Site settings, Agency → Mail defaults and Agency → Clients → {org},
   docs.
