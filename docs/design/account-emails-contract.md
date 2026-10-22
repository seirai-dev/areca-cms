# PR 2 — Account emails: implementation contract

Branch `feature/account-emails` (stacked on `feature/mail-foundation`).
Parent spec: `docs/design/email-notifications.md`. This file pins the names
and shapes so server, UI and docs work can run in parallel.

## Data

- `user.locale text null` (`'en' | 'nl' | 'tr'`). Migration `0024_user_locale`
  (generate with drizzle-kit from `apps/cms`). Declared in Better Auth
  `user.additionalFields.locale` (`type: 'string', required: false, input: false`).
- `Me.user` gains `locale: 'en' | 'nl' | 'tr' | null` and `emailVerified: boolean`.
- Backfill: when a signed-in user has `locale = null`, `getMeFn` stores the
  current interface locale (`getLocale()`), once.

## Templates (`src/server/mail/render/templates/*.ts`)

`MailTemplate` gains these names; for account emails `kind === template`.
Every template reads the recipient from `params.userId` at render time
(name + email), uses the recipient locale, the branded layout, and throws
`MailRenderError` (never retried) when the email no longer makes sense.

| Template | Stored params | Render-only params | Button / link |
|---|---|---|---|
| `password_reset` | `{ userId, encryptedToken? }` | `{ token }` | `${APP_URL}/reset-password?token=…` (valid 1 h, once) |
| `password_reset_sso` | `{ userId, providers: string[] }` | — | `${APP_URL}/login` ("You sign in with Microsoft") |
| `verify_email` | `{ userId }` | — | Better Auth verify link, derived at render (24 h) |
| `password_changed` | `{ userId, at }` | — | `${APP_URL}/forgot-password` ("Wasn't you? Reset it") |
| `two_factor_enabled` | `{ userId, at }` | — | `${APP_URL}/account` |
| `two_factor_disabled` | `{ userId, at }` | — | `${APP_URL}/account` |
| `membership_removed` | `{ userId, orgName, actorName }` | — | none (or `${APP_URL}/`) |
| `membership_role_changed` | `{ userId, organizationId, role, previousRole }` | — | `${APP_URL}/` |

Reset token storage: when a secrets key exists, `encryptedToken =
encryptSecret(token, 'email-outbox:params')`. Without a key nothing is
stored; the token only travels as a render-only param, so only the
immediate send can succeed and a retry fails with `MailRenderError`.

Verify link: `createEmailVerificationToken(env.BETTER_AUTH_SECRET, email,
undefined, 86400)` from `better-auth/api`, URL
`${BETTER_AUTH_URL}/api/auth/verify-email?token=…&callbackURL=${encodeURIComponent('/?verified=1')}`.
Already verified → `MailRenderError`.

## Outbox additions (`src/server/mail/outbox.ts`)

- `EnqueueEmailInput.renderParams?: Record<string, unknown>`: merged over
  `params` to render the subject at enqueue time; **never stored**.
- `sendNow(id, opts?: { renderParams?: Record<string, unknown> })`: merged
  over stored params for this attempt only; never stored or logged.
  Values must be added to `RenderedMail.secrets` by the template.

## Server module `src/server/mail/account-emails.ts`

```ts
export type AccountEmailKind =
  | 'password_reset' | 'password_reset_sso' | 'verify_email'
  | 'password_changed' | 'two_factor_enabled' | 'two_factor_disabled'
  | 'membership_removed' | 'membership_role_changed'

/** Queues an account email to a user (always on, verified or not). Skips
 *  (returns null, logs info) when mail isn't configured. `immediate` tries
 *  sendNow after enqueue (never inside a transaction). */
export async function sendAccountEmail(input: {
  kind: AccountEmailKind
  userId: string
  params?: Record<string, unknown>
  renderParams?: Record<string, unknown>
  immediate?: boolean
  connection?: Executor   // enqueue inside the caller's tx (no immediate send)
}): Promise<SendResult | { status: 'queued'; id: string } | null>

/** Better Auth sendResetPassword + admin action. SSO-only users get
 *  password_reset_sso and the reset token is deleted. */
export async function deliverPasswordReset(input: { user: { id, email }, token: string }): Promise<SendResult | null>

/** Admin "Send reset link": creates a reset token the same way Better Auth
 *  does (identifier `reset-password:${token}`, 1 h) and delivers it. */
export async function sendPasswordResetLink(userId: string, actorId: string): Promise<SendResult | null>

export async function sendVerificationEmail(userId: string): Promise<SendResult | null>
```

## Better Auth wiring (`src/lib/auth.ts`)

- `emailAndPassword.sendResetPassword: ({ user, token }) => deliverPasswordReset(...)`
  (errors logged, never thrown, so the response stays the same),
  `resetPasswordTokenExpiresIn: 3600`, `revokeSessionsOnPasswordReset: true`,
  `onPasswordReset: ({ user }) => sendAccountEmail({ kind: 'password_changed', ... })`.
- `emailVerification.sendVerificationEmail` → `sendVerificationEmail(user.id)`;
  `expiresIn: 86400`; `sendOnSignUp: false`.
- `hooks.after` on `/change-password` success → `password_changed`.
- Two-factor on/off → `two_factor_enabled` / `two_factor_disabled`
  (detect the actual change of `user.two_factor_enabled`).
- `hooks.before` on `/request-password-reset`: 3 per hour per email and 3 per
  hour per IP (Redis store; in-memory counts during an outage); over the limit → `APIError('TOO_MANY_REQUESTS')`
  with `m.server_password_reset_rate_limited()`.

## Other server changes

- `members.ts`: `removeMember` → `membership_removed`; `updateMemberRole`
  (role actually changed) → `membership_role_changed`. Not sent when the
  actor is the member. Enqueue inside the transaction (`connection: tx`).
- `acceptInvitation`: set `user.emailVerified = true` when the invitation's
  `deliveryStatus === 'sent'` (the link reached that inbox).
- `completeSetup`: after creating the first admin, `sendVerificationEmail`
  (not awaited for the response; errors logged).

## Server functions (`src/server/fn/account.ts`, new)

| Fn | Method | Guard | Input | Output |
|---|---|---|---|---|
| `getPasswordResetAvailabilityFn` | GET | public | — | `{ available: boolean, reason: 'ok' \| 'mail_not_configured' \| 'password_sign_in_disabled' }` |
| `requestVerificationEmailFn` | POST | signed in; 3/hour/user | — | `{ ok: true } \| { ok: false, message: string }` (already verified → ok) |
| `updateEmailLocaleFn` | POST | signed in | `{ locale: 'en' \| 'nl' \| 'tr' }` | `{ locale }` |
| `sendPasswordResetLinkFn` | POST | agency admin | `{ userId }` | `{ ok: true, status: 'sent' \| 'queued' \| 'sso' } \| { ok: false, message: string, ref?: string }` |

Each fn gets a row in `src/server/security/authz-matrix.ts`.

## UI (routes/features)

- `/forgot-password` (public): email field → always "If an account exists for
  {email}, we sent a link. It works for 1 hour." When unavailable: "Ask an
  agency admin to send you a reset link." Uses `authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })`.
- `/reset-password?token=` (public): new password + confirm (min 8, same
  rules as setup) → `authClient.resetPassword({ newPassword, token })` →
  success state "Password changed. Sign in again." → `/login`. Invalid or
  expired token → "This link has expired or was already used." + link to
  `/forgot-password`.
- Login: "Forgot password?" link next to the password label, only when
  email/password sign-in is enabled.
- App shell banner "Verify your email" for `!me.user.emailVerified`, with
  **Send verification email** and dismiss (localStorage per user id).
  `/?verified=1` shows a toast "Email verified".
- Account → **Email language** section (select en/nl/tr) → `updateEmailLocaleFn`.
- Agency → People: row action **Send reset link** (confirm dialog; toast with
  the readable result).

All copy in `messages/{en,nl,tr}.json`.
