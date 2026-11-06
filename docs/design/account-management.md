# Account management

Status: implemented. This is the design note written before the feature was built; the code and the [docs site](https://docs.arecacms.com) are the source of truth where they differ.

## Goals

1. Any user can delete their own account.
2. Agency admins can block and unblock a user from signing in.
3. Agency admins can delete a user.
4. Agency admins can add a user to one or more clients, with a separate role in each client (`owner` | `editor`), change that role, and remove them from a client.
5. Extras: edit display name (self and admin), change own password, admin "Sign out everywhere", admin "Reset 2FA", status filter + last active on the people list, pending invitations in the people list, invite to several clients from the agency people page, bulk actions, Cmd+K people search.

Out of scope: changing email addresses, grace period before deletion, bulk delete.

## Vocabulary

- Client = `organization`. Role per client = `membership.role` (`owner` | `editor`).
- Agency admin = `user.isAgencyAdmin`.
- "Active" agency admin = agency admin who is not blocked.

## Data model (PR 1, migration `0035_*`)

`user` gets:

- `blocked_at timestamp null`
- `blocked_by_id text null` → `user.id` on delete set null
- `blocked_reason text null` (internal, shown to agency admins only)

`oauthClient.userId`: change FK from cascade to **set null** (deleting a user who registered an OAuth client must not cut off other users' connections). Precedent: `drizzle/0032_publication_request_job_set_null.sql`.

Do not adopt the Better Auth `admin` plugin; its role model conflicts with `isAgencyAdmin`.

## Blocking

Effects of `blockUser(actor, targetId, reason?)`, in one transaction:

- set `blocked_at`, `blocked_by_id`, `blocked_reason`;
- delete all the target's `session` rows (signs them out everywhere);
- memberships are kept, so unblock restores everything;
- MCP keys and MCP OAuth connections are **suspended, not revoked**: every MCP auth path (`src/server/mcp/**` key lookup and OAuth token lookup) refuses requests while the owning user is blocked; unblocking makes them work again;
- queued notification emails for the user are cancelled and no new notifications are sent to a blocked user (check at send time like the existing access recheck);
- audit row `user.block` (meta: reason) / `user.unblock`;
- no email to the user on block/unblock.

Enforcement:

- Sign-in: a Better Auth `databaseHooks.session.create.before` check (see `src/lib/auth.ts` ~l.306) refuses session creation for blocked users with an error code `ACCOUNT_BLOCKED`. This covers password, social and SSO sign-in. The login page shows: "This account is blocked. Contact your agency." Never show the reason.
- Requests: `requireUser` in `src/lib/session.server.ts` treats a blocked user as signed out (defence in depth, sessions are already deleted).
- Password reset requests for blocked users silently do nothing (same response as unknown email).

## Who can act on whom

- Agency admin only, with fresh step-up (`requireFreshAgencyAdmin`) for: block, unblock, delete, reset 2FA, sign out everywhere, and the bulk versions.
- An admin cannot block or delete themselves from the admin screens (self-delete lives on /account).
- The last **active** agency admin cannot be blocked or deleted. Blocked admins do not count as active. Reuse/extend `assertAgencyAdminCanBeRemoved` in `src/server/admin/members.ts` with `FOR UPDATE` locking.
- Blocking or deleting another agency admin is allowed.

## Deleting a user

Hard delete of the `user` row. Existing FKs then cascade (sessions, accounts, 2FA, memberships, MCP keys/connections, notifications) or set null (entries, revisions, assets, publications, audit actor, outbox).

Before deleting, in the same transaction:

- write audit row `user.delete` with `meta: { deletedUserName, deletedUserEmail, self: boolean }` and `actorId` = the actor (null actor for self-delete would lose context, so actor = self is fine; the row survives with actor set null after deletion, so also store `actorName` in meta);
- revoke MCP OAuth tokens as `removeMember` does;
- queue the `account_deleted` email (security notice, ignores preferences) to the user's email address, rendered in their locale.

Author display: where a missing author currently shows "System" or nothing (`src/features/collection/entry-item.tsx` ~l.223, `src/features/editor/details-panel.tsx` ~l.471, `src/features/activity/activity-sentence.ts` ~l.269, publications/release diff), show **"Deleted user"** instead. Before changing a label, grep which code paths write a null `created_by`/`updated_by` on purpose (seeding, schema sync, scheduled jobs); if any exist, keep "System" for those cases (e.g. via the audit row) and use "Deleted user" otherwise. For audit rows, prefer `meta.actorName` when the actor is gone.

### Admin delete

- Allowed even when the target is the only owner of some clients; the confirm dialog lists those clients ("Acme will have no owner. Agency admins can still manage it.").
- Type-to-confirm with the user's email (`ConfirmDialog` `confirmText`).

### Self delete (`/account`, danger zone at the bottom)

- Confirm by typing your email, then re-verify: password if the user has a credential account; otherwise 2FA code if 2FA is enabled; SSO-only users without 2FA only type their email.
- Refused when the user is the only owner of any client: the section lists those clients with links to their People pages so they can promote someone first.
- Refused when the user is the last active agency admin.
- Immediate deletion, then sign out and land on `/login` with a notice "Your account was deleted."
- `account_deleted` email sent.

## Client access (per-user)

Server functions (agency admin, `requireAgencyAdmin`; role change/remove reuse `updateMemberRole`/`removeMember` with their last-owner protections and emails):

- `getUserDetailFn(userId)`: profile, status (blocked info incl. blocker name), 2FA on/off, has password, last active (max `session.updatedAt`, else last audit/sign-in if available), active session count, memberships (org id, name, slug, role, joined), whether the user is the only owner per membership, pending invitations for their email.
- `setUserClientAccessFn({ userId, add: [{orgId, role}], change: [{orgId, role}], remove: [orgId] })`: applies all in one transaction. Existing users are added directly (no invite). One `membership_added` email listing all newly added clients (new account email kind). Last-owner rules apply to change/remove (error names the client).
- `updateUserNameFn({ userId, name })` (admin) and `updateMyNameFn({ name })` (self). Audit `user.rename`. No email.

## Security actions (per-user, admin)

- **Sign out everywhere**: deletes all sessions of the user. Audit `user.sessions_revoke`. No email.
- **Reset 2FA**: deletes `two_factor` rows (secret + backup codes), sets `twoFactorEnabled=false`, deletes all sessions. Email `two_factor_reset` (security notice). Audit `user.two_factor_reset`. Agency admins are then forced to enrol again on next sign-in (existing behaviour); others may re-enable.
- **Reset password**: existing.

## Self-service extras (/account)

- Profile section: display name becomes editable (inline edit, save on Enter/blur with explicit Save button on mobile).
- Change password section (only for users with a credential account): current password, new password (+ confirm). Uses Better Auth `changePassword` with `revokeOtherSessions: true`. Users without a password do not see the section.
- Danger zone: Delete account (above).

## Agency people list (`/agency/people`)

- Rows link to `/agency/people/$userId`.
- Status filter: All / Active / Blocked / Invited / 2FA off. Existing search, role and client filters stay.
- "Last active" shown per row (relative time; hidden below `sm`, moved to the secondary line).
- Blocked rows: `Tag tone="error"` "Blocked", name dimmed.
- Pending invitations appear as rows tagged "Invited" showing client(s), role and expiry, with Resend, Copy link, Revoke in the row menu (reuse existing invitation fns).
- "Invite person" button: email field, then a multi-client picker with a role per client. If the email belongs to an existing user, the sheet says so and offers "Add to clients directly" instead.
- Bulk: row checkboxes; a bottom action bar (full-width on mobile) with Add to clients, Block, Unblock, Sign out everywhere. One step-up for the batch. Self and the last active admin are skipped with a note. No bulk delete.

## Per-user page (`/agency/people/$userId`)

Layout uses the existing settings pattern (title column left, controls right, stacked below 900px).

```
← People
(avatar) Jane Doe   jane@acme.com                [⋯]
Last active 2h ago · 2FA on · Agency admin [switch]
[Blocked band when blocked: "Blocked 3 days ago by Sam" + Unblock]
───────────────────────────────────────────────
Clients      | access table: client · Owner|Editor · remove
             | + Add to clients… (searchable multi-select)
             | save bar: "+2 clients · 1 role change · 1 removal"  [Discard] [Save]
Security     | 2FA status · Reset 2FA; Sessions N · Sign out everywhere; Reset password
Profile      | Name (editable)
Danger zone  | Block / Unblock · Delete user
```

- The access table is staged: picks appear as iris-tinted pending rows, role changes and removals are shown inline (removed rows struck through with Undo) until Save. Save applies everything through `setUserClientAccessFn`.
- Client picker: popover with `cmdk` search input, list of clients with a checkbox, clients the user already belongs to shown disabled with their current role, a default role selector in the footer, "Add N clients" button. On mobile the picker is a bottom sheet (`SlideOver`/`Sheet` bottom).
- Mobile: client rows show name + role text + chevron; tapping opens a bottom sheet with the role segmented control and "Remove from client". No stacked per-row buttons, no nested cards.
- Blocked band: error tone, full width under the header.

## Cmd+K

Agency admins: typing in the palette searches people by name/email (server search, debounced, top 8) and jumps to `/agency/people/$userId`; results show Blocked/Invited tags.

## Emails (new account email kinds, security notices ignore preferences)

- `account_deleted` (self or admin; copy differs: "You deleted your account" vs "An agency admin deleted your account").
- `membership_added` (lists client names, link to `/`).
- `two_factor_reset`.
- No email for block/unblock, sign out everywhere, rename.

All copy in en, nl, tr via `scripts/i18n-add.mjs`.

## Audit actions

`user.block`, `user.unblock`, `user.delete`, `user.rename`, `user.sessions_revoke`, `user.two_factor_reset`, `member.add` (direct add). Each gets a sentence in `src/features/activity/activity-sentence.ts`.

## Tests

- PR 1 DB tests (`*.db.test.ts`): block blocks session creation and MCP auth; unblock restores; last active admin protections incl. concurrent case; delete keeps content with null authors; oauthClient survives; self-delete refused for sole owner; client access batch incl. last-owner error; reset 2FA; emails queued; audit rows.
- PR 2/3 unit tests for UI helpers (staged diff summary, filters) and Playwright specs: block → blocked user cannot sign in → unblock; admin delete; access table add/change/remove; invite to several clients; bulk block; self rename, password change, self delete; mobile viewport (390) for the per-user page.
