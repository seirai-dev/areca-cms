# 05. CMS code inventory (apps/cms)

Source of truth: code under `/Users/ek/development/projects/areca-cms/apps/cms/src`. Read-only research; no repo files were edited. Items marked **(unverified)** were not confirmed in code.

---

## 1. Route map

Layout guards live in `src/routes/_app.tsx` (not signed in → `/login?redirect=…`; no users yet → `/setup`; agency admin without 2FA → `/account`). Per-route guards below are from each route's `beforeLoad`.

### Public / bootstrap

| File | URL | Screen | Access |
| --- | --- | --- | --- |
| `routes/login.tsx` | `/login` | Sign-in: email/password, social buttons, Microsoft SSO, TOTP challenge | Anyone. Redirects to `/setup` if no users exist. |
| `routes/setup.tsx` | `/setup` | First-run bootstrap: creates the first agency admin (needs setup token) | Anyone, only while no user exists. Redirects to `/` or `/login` once users exist. |
| `routes/invite/$token.tsx` | `/invite/:token` | Invitation landing: shows org/role, accept | Public to view (`getInvitationFn`); accepting needs a signed-in user (`acceptInvitationFn`). |

### Signed-in workspace (`_app` layout)

| File | URL | Screen | Access |
| --- | --- | --- | --- |
| `routes/_app/index.tsx` | `/` | Redirect hub: one site → `/sites/:siteId`; agency admin → `/agency`; otherwise → `/sites` | Any signed-in user |
| `routes/_app/account.tsx` | `/account` | Profile, two-factor setup/disable/backup codes | Any signed-in user |
| `routes/_app/sites/index.tsx` | `/sites` | Site list / picker | Any signed-in user |
| `routes/_app/sites/$siteId.tsx` | `/sites/:siteId` | Site overview (Overview). Side panels via `?panel=activity` or `?panel=golive` | Site members; `notFound` if no access |
| `routes/_app/sites/$siteId/library.tsx` | `/sites/:siteId/library` | Shared client Library (images + PDFs) | Any member (delete requires owner) |
| `routes/_app/sites/$siteId/people.tsx` | `/sites/:siteId/people` | Members and invitations (`?invite=1` opens invite sheet) | Owner or agency admin; others redirected to site overview |
| `routes/_app/sites/$siteId/settings.tsx` | `/sites/:siteId/settings` | Site settings tabs: General, Deployment, Developer, AI, Content | **Agency admin only** (others redirected) |
| `routes/_app/sites/$siteId/c/$collectionKey/index.tsx` | `/sites/:siteId/c/:collectionKey` | Content list for one content type (list/cards, filters, bulk actions) | Any member |
| `routes/_app/sites/$siteId/c/$collectionKey/new.tsx` | `/sites/:siteId/c/:collectionKey/new` | New entry | Editors and up |
| `routes/_app/sites/$siteId/c/$collectionKey/$entryId.tsx` | `/sites/:siteId/c/:collectionKey/:entryId` | Entry editor (fields, rich text, Details panel, history, schedule, SEO) | Any member; publish actions owner-only |
| `routes/_app/sites/$siteId/{activity,releases,media,team}.tsx` | `/sites/:siteId/activity`, `/releases`, `/media`, `/team` | Legacy redirects: activity and releases → overview panels; media → library; team → people | As target |
| `routes/_app/orgs/$orgId/members.tsx` | `/orgs/:orgId/members` | Legacy redirect: agency → `/agency/clients/:orgId`; owner → People of first site; else `/` | Redirect logic only |
| `routes/_app/orgs/$orgId/audit.tsx` | `/orgs/:orgId/audit` | Legacy redirect: agency → `/agency/activity`; owner → first site activity | Redirect logic only |

### Agency workspace (`_app/agency`, guard: `isAgencyAdmin`, otherwise `/`)

| File | URL | Screen |
| --- | --- | --- |
| `agency/index.tsx` | `/agency` | Agency overview: clients, sites needing attention, getting-started checklist |
| `agency/clients/index.tsx` | `/agency/clients` | Client list, create client |
| `agency/clients/$orgId.tsx` | `/agency/clients/:orgId` | Client detail tabs: **Sites**, **People**, **Deployment** (Dokploy), **Settings** (rename / delete) |
| `agency/people.tsx` | `/agency/people` | All user accounts; grant or remove agency-admin access |
| `agency/activity.tsx` | `/agency/activity?client=` | Instance-wide activity log, optional client filter |
| `agency/branding.tsx` | `/agency/branding` | White-label branding (app name, logo, favicon, accent colour, typography, invite sender name) |
| `agency/ai.tsx` | `/agency/ai` | OpenRouter connection (API key, model, shared prompt) |
| `routes/_app/admin/index.tsx`, `admin/$.tsx` | `/admin`, `/admin/*` | Legacy redirects into `/agency/*` (`/admin/clients/:id` → client page, `/admin/people` → agency people, `/admin/activity`, `/admin/branding`) |

### Public HTTP routes (`routes/api/**`)

See section 4. Also `routes/api/auth/$.ts` (Better Auth handler at `/api/auth/*`).

### Note on `/__preview/...`

The preview URL built by `createPreviewUrl` points at `/__preview/<collection>/<slug>?token=…` on the **website**, not the CMS. The CMS only serves `/api/sites/preview`.

---

## 2. Roles and access (authz)

Sources: `src/server/security/authz-matrix.ts` (data), `docs/AUTHZ_MATRIX.md` (human version), `src/server/security/authz-harness.ts`.

### Role model

- **Agency admin**: `user.isAgencyAdmin` boolean (instance-wide). Must have TOTP when `ADMIN_MFA_REQUIRED=true` (default).
- **Organization owner**: `membership.role = 'owner'` per client org.
- **Organization editor**: `membership.role = 'editor'` per client org.
- Precedence: agency admin > owner > editor.

### Policies (from `POLICY_EXPECTATIONS`)

| Policy | Meaning |
| --- | --- |
| `public` | Anyone, including anonymous |
| `user` | Any signed-in user (anonymous → login redirect) |
| `org-editor` | Editor, owner or agency admin of the target org (2FA-gated for admins). Other orgs get 403 |
| `org-owner` | Owner or agency admin of the target org |
| `agency` | Agency admin with 2FA (MFA_REQUIRED otherwise) |
| `agency-fresh` | Agency admin with 2FA and a session re-verified in the last 10 minutes (REAUTH_REQUIRED otherwise) |

Object-addressed rows (site/entry/asset/job/invitation) return NotFound to outsiders so IDs cannot be probed.

### What each role can do (from the matrix and UI guards)

| Capability | Editor | Owner | Agency admin |
| --- | --- | --- | --- |
| View site, content lists, Library | yes | yes | yes |
| Create entry, edit draft, preview, autosave | yes | yes | yes |
| Upload files, edit file description (alt text) | yes | yes | yes |
| Generate AI SEO suggestions (`generateEntrySeoFn`, 30/hour) | yes | yes | yes |
| Mark ready, publish, unpublish, schedule, cancel schedule | no | yes | yes |
| Archive, delete entry, restore revision | no | yes | yes |
| Delete Library file | no | yes | yes |
| Go live, rollback, cancel build job, reconcile deployment | no | yes | yes |
| Resolve uncertain deployment (reason + confirmation) | no | no | yes |
| Site People: invite, change role, remove, revoke, resend | no | yes | yes |
| Site activity / audit log (`listAuditLogFn` per org) | no | yes | yes (instance log under Agency › Activity) |
| Site Settings tabs | no | no | yes (`settings.tsx` guard) |
| Create/delete clients, sites, content types (`upsertCollectionFn`, `deleteCollectionFn`) | no | no | yes |
| Dokploy credentials per client; delete site; rotate site token | no | no | yes (`agency-fresh` for destructive/credential ops) |
| Branding, global AI settings | no | no | yes |
| Grant/remove agency admin (`setAgencyAdminFn`) | no | no | yes (fresh) |

Two-factor sessions: `verifyStepUpFn` needs a TOTP session. Any other sensitive call on an `agency-fresh` row needs a TOTP re-verification within 10 minutes (`step-up.ts`).

---

## 3. Features by folder (`src/features/*`)

Labels below are the exact English strings from `apps/cms/messages/en.json` where quoted.

### account/
- `account-screen.tsx`, `two-factor-section.tsx`, `use-two-factor.ts`.
- Profile (read-only name and email) and two-factor authentication.
- Labels: "Set up two-factor", "Scan this code with an authenticator app…", "Secret key", "Verify and turn on", "Save these backup codes…", "I've saved them", "New backup codes", "Turn off". Password is required to change 2FA unless the account has no password (passwordless is allowed by the two-factor plugin plus a fresh-session check).
- Agency admins: banner "Set up two-factor authentication" ("Agency admins must use two-factor authentication…"). Account page also has "Back to workspace".
- Flow: begin enable → show QR and secret → verify 6-digit code → show backup codes once → done.

### activity/
- `activity-list.tsx`, `activity-item.tsx`, `activity-panel.tsx`, `agency-activity-screen.tsx`, `activity-sentence.ts`.
- Human-readable sentences over the `audit_log` table. Tabs/filters for scope: site (panel on overview), client, or instance-wide (Agency › Activity).
- Example sentences: "granted agency admin access", "revoked agency admin access", "updated the AI settings".

### agency/
- Overview (`agency-overview-screen.tsx`, `getting-started.tsx`): clients, sites, attention list (failed releases: "The last release of {site} failed").
- Clients (`clients-screen.tsx`, `client-screen.tsx`, `client-settings.tsx`, `client-deployment.tsx`, `client-tile.tsx`): tabs **Sites**, **People**, **Deployment**, **Settings**. Create client, New site sheet (`new-site-sheet.tsx`, with `slug-field.tsx`).
- People (`agency-people-screen.tsx`): all accounts, agency-admin toggle.
- Branding (`branding-screen.tsx`, `branding-preview.tsx`, `use-branding-form.ts`): sections "Identity" (app name, logo, favicon), "Colour" (presets and accent), "Typography" (fonts `inter`, `manrope`, `figtree`, `system`; default `inter`), invite email sender name, "Reset to defaults".
- AI (`ai-settings-screen.tsx`, `use-ai-settings.ts`): "Connection" (provider OpenRouter, API key, "Remove key"), "Encryption" note, "Model", "Prompt" (shared system prompt, "Null means the built-in default prompt").
- Site cards (`site-card.tsx`), queries, helpers.

### auth/
- `login-screen.tsx`, `setup-screen.tsx`, `invite-screen.tsx`, `two-factor-challenge.tsx`, `provider-buttons.tsx`, `password-input.tsx`, `auth-shell.tsx`, `use-auth-forms.ts`.
- Sign-in methods shown only when configured (see section 5). Invite acceptance. Setup wizard (first admin, needs setup token).

### collection/
- `collection-screen.tsx` (main list, 23 KB), `collection-controls.tsx`, `entry-item.tsx`, `entry-cover.tsx`, `entry-pill.tsx`, `use-collection-entries.ts`, `scheduled-poll.ts`.
- Views: "List" / "Cards". Status filters: "All", "Drafts", "Ready & live", "Scheduled", "Archived". Search "Search {name}". Paging "Show more" / "Load more", "Showing {shown} of {total}".
- Create: "Write the first entry", "New {name}" (shortcut `n`).
- Bulk selection: "Select", "Selection actions": "Mark as ready" (toast "Marked {count} entries as ready."), "Move back to draft", "Delete" (confirm "Delete {count} entries?", "This action cannot be undone.").
- Disabled content type banner: "This content type is turned off because it's no longer in the site project…".

### content-model/
- `content-model-tab.tsx` (Settings › Content), `schema-editor-sheet.tsx`, `schema-fields.tsx`, `use-schema-editor.ts`, `schema-drafts.ts`.
- Lets an agency admin enable/disable content types (switch "Turn on" / "Turn off"), create or edit types (name, route, availability), and edit fields (reorder by drag, "Help text", "Links to" for reference, "Choice" options separated by commas, "Required" hint). Unsaved changes guard: "You changed this content type. If you close it now, those changes are lost."
- Field types offered in UI: "Short text", "Long text", "Rich text", "Image", "Date", "Date and time", "Choice", "Slug", "Yes / no", "Number", "Link to entry", "Web address" (see section 6).
- Locked fields: "Built-in field" (title and slug are locked).
- Types normally come from the site project's `areca.config` via manifest sync ("Push it to sync" in the site project).

### editor/
- `editor-screen.tsx`, `editor-top-bar.tsx`, `editor-canvas.tsx`, `use-entry-editor.ts`, `details-panel.tsx`, `fields/` (structured fields), `rich-text/` (TipTap-style toolbar and slash menu), `media-picker.tsx`, `media-upload.ts`, `history.tsx`, `revision-groups.ts`, `save-indicator.tsx`, `schedule-form.tsx`, `schedule-time.ts`, `scheduled-version.tsx`, `draft-recovery.ts`, `seo-panel.tsx`, `ai-seo-dialog.tsx`.
- Autosave with status: "Saving…", "Saved", "All changes saved", "Couldn't save", retry. Shortcut ⌘S / Ctrl+S "Save now".
- Status labels: "Draft", "Ready", "Ready to go live", "Edited since ready", "Live", "Scheduled", "Archived".
- Actions: "Mark as ready", "Mark as ready & go live now", "Schedule…" ("Schedule going live", time zone picker, quick picks "In 1 hour", "Tomorrow 9:00", "Monday 9:00"), "Cancel schedule", "Move back to draft", "Archive", "Delete…", "Preview", "Open in new tab", "Copy link to entry", "Copy ID".
- Details panel tabs: "Fields", "Page", "History". History entries: "Created", "Edited · {count} saves", "Marked as ready", "Scheduled", "Schedule cancelled", "Moved back to draft", "Restored an earlier version". Restore requires confirm "Restore this revision?" ("The current draft is replaced…").
- Delete: "Delete this entry?" with "Referenced by: {titles}." when other entries link to it.
- Rich text tools: Bold, Italic, Link, Headings 2–4, Bullet/Numbered list, Quote, Code block, Insert image, Insert table (add/delete row/column/table), Divider, Undo/Redo. `/` menu. Links must be http(s) or mailto ("Links open in a new tab on the live site.").
- Image fields: "Choose an image" ("From the Library, or upload a new one"), "Replace image", "Remove image". Media picker search "Search files".
- AI SEO dialog (`ai-seo-dialog.tsx`): "SEO suggestions", "Generate with AI", "Select all / none", "Apply {count}", "Suggestions applied", "No new suggestions: everything already matches." Also proposes **alt text for images missing a description** ("Alt text for {file}", saved to the Library image). Text-only or "with images" (model line "{model} · {images}").
- SEO panel (`seo-panel.tsx`, 27 KB): groups "Search", "Social sharing", "AI answers (GEO)", "Structured data", "Indexing & advanced". Fields: "SEO title", "Meta description", "Focus keyphrase" (with checks), "Canonical URL", "Hide from search engines" (noindex), "Don't follow links" (nofollow), "Social title/description/image" (1200×630 suggested), "X / Twitter card" (summary or large image), "TL;DR summary", "Key takeaways", "FAQ" (question/answer, also FAQPage JSON-LD), "Topics & entities" (name + Wikipedia/Wikidata link), "Author" (name, profile URL, bio), "Schema type" (BlogPosting, NewsArticle, Article), "Extra JSON-LD". "Search result preview".
- Draft recovery: when a save cannot reach the server the editor keeps a local copy in the browser and offers it on reopen (`draft-recovery.ts`).
- Leaving unsaved: "Leave without saving your latest changes?" with "Stay" / "Leave without saving".

### golive/
- `golive-panel.tsx` (37 KB), `golive-tray.tsx`, `use-go-live.ts`, `use-release-status.ts`, `use-pending-entries.ts`, `entry-live-state.ts`, `queries.ts`, `parse-errors.ts`.
- Go-live pipeline and releases. Hero copy: "{site} is live and up to date.", "{site} isn't live yet. {changes}.", "The last release failed. The live site hasn't changed.", "{site} is going live."
- Buttons: "Go live", "Urgent — skip the queue" (hint: "Goes before other sites waiting to go live."), "Restore this version" (rollback from a prior release, see section 7; no separate "Request rollback" label exists in en.json), "View log", "Try again", "Dismiss", "Check deployment status" (reconcile).
- Changes listed as "What's changing"; "{count} change ready".
- Release statuses: "Waiting", "Going live", "Live", "Failed", "Rolled back", "Replaced".
- Build job statuses: "Queued", "Building", "Checking" (validating), "Deploying", "Done", "Cancelled", "Failed".
- Uncertain deployment: "The deployment outcome is unknown. Check its status before publishing again…" and "Release publishing block" (agency resolves with reason + confirmation).
- Demo vs production is shown on the release.
- Empty state: "No releases yet. Your first Go live will appear here." / "Mark content as ready, then go live to publish the site."

### library/
- `library-screen.tsx`, `asset-detail.tsx`, `use-library.ts`.
- Shared across all client sites. Upload by button, drop on page ("Drop to add to Library"), or from image fields. Accepts JPEG, PNG, WebP, GIF (images), PDF; 20 MB per file.
- Search "Search the Library"; filter "Missing description" ("{count} need a description", "Show all files"). Detail: "Description (alt text)", "File details" (Type, Size, Dimensions, Uploaded, By), "Copy link", "Delete…" ("Only owners can delete files from the Library."). Delete blocked while still referenced.

### overview/
- `overview-screen.tsx`, `greeting.ts`. Dashboard: greeting, "Needs attention", create tiles ("New entry"), recent edits, recent activity (owners and admins), site-level shortcuts. Cross-site `home` activity and sites overview for any signed-in user.

### people/
- `people-manager.tsx` (19 KB), `invite-sheet.tsx`, `people-screen.tsx`, `use-members.ts`.
- Members and invitations for a client. Roles: "Owner" ("Can also make changes live and manage people."), "Editor" ("Can write and edit drafts.").
- Invite sheet: comma-separated emails, "They'll join as", "Invite people", "Send {count} invitations", result states "Sent", "Email not delivered", "Invitation created, email not sent. Use “Send again”…", "Copy link" (link valid 7 days). Pending list: "Expires {time}", "Expired", "Send again", revoke.
- Remove: "Remove from {client}…". Demote self: "Make yourself an editor?".

### security/
- `step-up.tsx`: re-verify modal ("TOTP re-check") before sensitive actions. Blocks after repeated failures (see section 5).

### shell/
- `site-workspace.tsx`, `resolve-workspace.ts`, `last-site.ts`, `panel.ts`.
- Global chrome: sidebar (Overview, Content types, Library, People, Settings; Agency items for admins), mobile tab bar (Overview, Content, Library, More), workspace switcher ("Switch workspace", "Recent", "New site…"), command palette (⌘K / Ctrl+K: "Search or jump to…", "Go to", "Create", "Invite people", "Change language to …", "Switch appearance").
- Keyboard: `g o` Overview, `g l` Library, `g p` People, `g s` switch site, `n` new entry, `/` page search, `⌘.` toggles Details, `⌘S` save.
- Theme: "Light", "Dark", "Auto" (System). Language selector.
- Empty/404: "This page doesn't exist" → "Go to your workspace".

### site-settings/
- `site-settings-screen.tsx`, `general-tab.tsx`, `deployment-tab.tsx` (16 KB), `developer-tab.tsx`, `ai-tab.tsx`, `token-reveal.tsx`, `settings-save-bar.tsx`, `use-site-settings.ts`.
- Tabs: **General** ("Site" name, production URL, "Delete site…" danger zone: "Removes the site, its entries, releases and settings for everyone."), **Deployment** (mode Production or Demo; Dokploy "Application" picker plus manual application ID; "Health check URL" optional, checked after each deploy; "Stop deploying…"; "Rotate token"), **Developer** ("Site key", site token (shown once: "Save this token now", stored as `ARECA_SITE_TOKEN` in the site project), "Rotate token…", quick-start commands `areca init --site-key`), **AI** ("AI instructions", appended to the agency prompt, "Site instructions for AI"), **Content** (content types list, "New content type", switches).
- Production URL: "Enter a full address, like https://example.com."

### sites/
- `site-picker.tsx`: site search and list (used for workspace switching). "Search by site name or slug".

---

## 4. Public HTTP endpoints

| Method | Path | Auth | Purpose | Rate limit |
| --- | --- | --- | --- | --- |
| GET | `/api/sites/manifest` | `Authorization: Bearer <build token>` (site hash match) | Read enabled content types (fields, route) for the site project | Site API bucket: 300/min per token (or IP) |
| POST | `/api/sites/manifest` | `Bearer <schema token>` (`privilege: 'schema'`) | Push the site project's content-type manifest (sync). Max 256 KB, 100 collections, 100 fields each | Same bucket |
| GET | `/api/sites/snapshot/current` | `Bearer <build token>` | Latest publication snapshot (live, or demo for demo mode). During an active build it returns the building publication. JSON, `Cache-Control: no-store`. 404 if none | Same bucket |
| GET | `/api/sites/preview` | `?token=` signed preview token (HMAC, 1 h TTL, per site `previewSecret`) | Draft entry payload for preview on the site. `no-store` | Mutation/GET not limited |
| GET / OPTIONS | `/api/assets/file/:prefix/:filename` | **Public** (no auth). Sets `Access-Control-Allow-Origin: *`, GET/OPTIONS only | Stream uploaded image/PDF from S3 | none |
| POST | `/api/assets/upload` | Signed-in org member (`requireOrgMember`) | Multipart upload into the Library | 10/min per user (upload bucket) |
| POST | `/api/admin/branding/upload` | Agency admin (MFA) | Upload branding logo/favicon | 10/min per user |
| GET / POST | `/api/auth/*` | Better Auth endpoints (sign-in, sessions, 2FA, SSO callbacks) | Authentication | Global non-GET limit (60/min) applies to POST |
| GET | `/api/health` | none | Liveness: `{ ok: true, service: "cms" }` | Probes exempt |
| GET | `/api/health/ready` | none | Readiness: DB, Redis, worker heartbeat, queue age. 503 on failure | Probes exempt |
| GET | `/api/metrics` | `Authorization: Bearer <METRICS_TOKEN>` (≥16 chars); 404 if unset | Prometheus-style metrics | 60/min per IP |

Server functions (`createServerFn`) are called by the UI over RPC and are not public API. Full list is in `docs/AUTHZ_MATRIX.md`. Global rate limit for all other non-GET/HEAD/OPTIONS requests: **60/min per user or IP**.

Rate limiting lives in `server/http/rate-limit.ts` (rules) and `rate-limit.server.ts` (Redis store). Redis failure logs and allows (fails open). `RATE_LIMIT_TRUST_PROXY=true` is needed to trust `X-Forwarded-For` for the IP key.

Other limiters: AI SEO generation 30/hour per user (`server/fn/ai.ts`, `GENERATE_RULE`). Step-up TOTP lockout after 5 failures for 15 min (`step-up.ts`).

---

## 5. Environment variables

Source: `apps/cms/src/env.ts` (validated with zod, `@t3-oss/env-core`) and `apps/cms/.env.example`. `.env.local` then `.env` are loaded. Validation is skipped during builds or with `SKIP_ENV_VALIDATION=true`.

### Required (no default)

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL |
| `BETTER_AUTH_SECRET` | Session signing secret (min 1 char in code; `change-me` is accepted, so change it) |
| `BETTER_AUTH_URL` | Public CMS URL used for auth callbacks |
| `APP_URL` | Public CMS origin for invitation and asset links |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | S3-compatible storage for assets and branding |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | Invitation email (no SMTP auth variables exist) |
| `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` | Base64 32-byte key (regex `^[A-Za-z0-9+/]{43}=$`), **required** at startup |

### Optional with defaults

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUTH_EMAIL_PASSWORD_ENABLED` | `true` | Email/password sign-in on; `false` removes form and blocks endpoint (setup still accepts a password) |
| `ADMIN_MFA_REQUIRED` | `true` | Agency admins must enrol TOTP. Set `false` only for dev/e2e |
| `REDIS_URL` | `redis://localhost:6379` | Rate-limit counters |
| `RATE_LIMIT_TRUST_PROXY` | unset (false) | Trust forwarding headers for client IP |
| `WORKER_ENABLED` | `true` (only `false` disables) | Run publish worker and scheduler in this process |
| `WORKER_CONCURRENCY` | `2` (1–16) | Concurrent build jobs per process |
| `WORKER_DRAIN_TIMEOUT_MS` | `8000` | Shutdown wait for in-flight jobs |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | 0 disables |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | 0 disables |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `30000` | 0 disables |
| `READINESS_TIMEOUT_MS` | `3000` (min 100) | Per-dependency readiness deadline |
| `READINESS_MAX_QUEUE_AGE_SECONDS` | `900` | Readiness fails when the oldest queued build is older |
| `READINESS_MAX_TICK_AGE_SECONDS` | `300` | Readiness fails when the worker/scheduler heartbeat is older |

### Optional, no default

| Variable | Meaning |
| --- | --- |
| `SERVER_URL` | Optional server URL override (declared; rarely needed) |
| `GITHUB_CLIENT_ID` / `_SECRET` | GitHub sign-in (both required) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google sign-in |
| `DISCORD_CLIENT_ID` / `_SECRET` | Discord sign-in |
| `MICROSOFT_SSO_CLIENT_ID` / `_SECRET` | Entra ID OIDC sign-in (enabled when both set) |
| `MICROSOFT_SSO_TENANT_ID` | Required for Microsoft. `common` not supported |
| `MICROSOFT_SSO_DOMAIN` | Optional email domain for routing SSO |
| `SETUP_TOKEN` | Min 16 chars. Gates `/setup`. If unset and no users, a token is generated and logged per process |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO/RustFS-style endpoints (adapter reads `=== 'true'`, default false) |
| `DOKPLOY_URL` | Legacy process-wide Dokploy URL (dev fallback only) |
| `DOKPLOY_API_KEY` | Legacy process-wide Dokploy key (dev fallback only) |
| `DOKPLOY_DEV_FALLBACK_ENABLED` | `true` lets the legacy URL/key pair be used; ignored when `NODE_ENV=production` |
| `DOKPLOY_ALLOW_INSECURE_HTTP` | `true` allows http Dokploy URLs (dev/LAN only) |
| `ALLOW_PRIVATE_HEALTH_CHECKS` | `true` allows private health-check targets (dev/LAN only) |
| `AI_SETTINGS_ENCRYPTION_KEY` | Base64 32-byte key encrypting the OpenRouter key. AI stays off without it |
| `METRICS_TOKEN` | Min 16 chars. Unset → `/api/metrics` returns 404 |
| `VITE_APP_TITLE` | Browser title (only client-prefixed var) |

### In `.env.example` but not in `env.ts`

- `LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`; default `info`) is read directly from `process.env` in `server/log.ts`.
- `SKIP_ENV_VALIDATION`, `npm_lifecycle_event` (build detection) are read by `env.ts`.

---

## 6. Content model

Sources: `src/lib/types.ts`, `src/server/content/validation.ts`, `src/lib/content-limits.ts`, `src/routes/api/sites/manifest.ts` (manifest schema), `src/server/content/seo.ts`, `src/server/content/snapshot.ts`.

### Field types

| Type | UI label | Validation |
| --- | --- | --- |
| `text` | Short text | string, max **1,000** chars. Required: min 1 |
| `textarea` | Long text | string, max **50,000** chars |
| `richtext` | Rich text | Rich text JSON document. Limits: depth 32, nodes 20,000, text 200,000 chars, 16 marks per node, 50 errors reported. Required fails on an empty doc |
| `image` | Image | Asset id (≤128 chars). Must reference a Library image (checked on write) |
| `date` | Date | ISO date (`YYYY-MM-DD`) |
| `datetime` | Date and time | ISO datetime, max 64 chars |
| `select` | Choice | string ≤500 chars. If `options` set, value must be one of them (≤200 options, ≤200 chars each in manifest) |
| `reference` | Link to entry | Entry id (≤128). Must exist in the target collection (`collection` prop) and, by default, be **published** (`requirePublished`) |
| `slug` | Slug | Lowercase letters, digits, hyphens (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), max 200. Required: min 1 |
| `boolean` | Yes / no | boolean |
| `number` | Number | number |
| `url` | Web address | string ≤2,048 chars, must parse as URL with `http:` or `https:` |

Field properties (manifest, `fieldSchema` is strict; unknown keys rejected): `key` (safe identifier; the UI says it cannot change later), `label` (≤200), `type`, `required`, `options`, `collection` (reference target), `description` (help text, ≤1,000), `after` (date/datetime only: must be on or after another date field of the same entry).

### Modes and limits

- `strict` mode (publish/ready) enforces required fields. `partial` mode (draft save) allows missing required values.
- Entry data total ≤ **1 MiB** JSON.
- Manifest ≤ **256 KiB**, ≤ **100** collections, ≤ **100** fields per collection, route pattern ≤ 500 chars (must include `$slug`).
- Reference cycle and inbound-reference checks exist (`inbound-references.ts`); delete warns "Referenced by: …".

### SEO block

Each published entry in the snapshot carries a resolved `seo` object (`SeoMeta`: title, description, canonical, robots, Open Graph, Twitter, author, summary, key takeaways, FAQ, about, JSON-LD). Authored in the SEO panel and generated by AI on request.

### Localisation

- **Content is not localised.** No per-field or per-entry locale exists in the schema, types or validation. `locale` only appears in sort helpers.
- **UI** is available in English (base), Dutch (`nl`), Turkish (`tr`). Changing language does not translate content (CMS_GUIDE says so).

---

## 7. Publishing, releases, and background work

Sources: `src/server/publishing/*` (worker, scheduler, publications, shutdown), `src/server/ops/*`, `src/server/admin/dokploy-credentials.ts`.

### Entry lifecycle (DB `entry.status`)

`draft` → `published` (UI "Ready") → live as part of a release → `archived`. `scheduled` is set with `scheduledAt` and `scheduledData` (a frozen approved version). Revisions are kept (`entry_revision`). Deletion moves content to `deleted_content_archive` (`deletion-archive.ts`).

### Publication pipeline

1. **Request** (`requestPublicationFn`, owner): locks site row, checks production target + health URL (demo skips this), `assertDispatchResolved`, `assetMutationLock`, builds snapshot (`buildSnapshot`), inserts `publication` (status `pending`) and `build_job` (`queued`). One blocking job per site.
2. **Worker** (`publishing/worker.ts`, in CMS process when `WORKER_ENABLED`): claims `queued` jobs with a 60 s lease (heartbeat 15 s). Tick every 3 s (`intervalMs = 3000`). Jobs run in parallel up to `WORKER_CONCURRENCY`, one per site.
3. **Stages** (job log lines): `building` (snapshot) → `validating` ("validating snapshot") → `deploying` ("deploying") → health check (`health check <url>`, polls every 5 s, 2-minute timeout). Deploy poll every 5 s, 15-minute deploy timeout.
   - Demo mode: "Demo publication: no production deployment or live verification". Ends `demo`.
   - Production: Dokploy `deploy` for the site's application; health URL must report the publication id. On success the previous live publication becomes `superseded` and the new one `live`.
4. **Failure**: job `failed`, publication `failed`; previous live stays live. Logs are capped (256 KB per job, 8 KB per line).
5. **Cancel**: `cancelJobFn` (owner). Only before deploy.
6. **Rollback**: `requestRollbackFn` (owner) queues a high-priority build from a prior successful release's stored snapshot and content hash. It does not rebuild from current drafts.
7. **Uncertain deployment**: if a Dokploy call's outcome is unknown, the site stays blocked. Owner can reconcile (`reconcileDeploymentJobFn`). Agency admin can resolve with a reason and upstream-stop confirmation (`resolveUncertainDeploymentJobFn`).
8. **Stale job recovery**: `recoverStaleJobs` after 30 min in building/validating/deploying.
9. **Shutdown**: SIGTERM/SIGINT drains running jobs for `WORKER_DRAIN_TIMEOUT_MS`.

Statuses: publication `pending | building | demo | live | failed | superseded | rolled_back`; build job `queued | building | validating | deploying | succeeded | failed | cancelled`.

### Scheduler

`publishing/scheduler.ts` runs every ≤15 s. It finds `scheduled` entries whose time has passed and whose site has no blocking job, then starts a release with actor `system` ("Started automatically"). Owners can cancel a schedule ("Schedule cancelled").

### Dokploy

- Per-organization API URL and key stored encrypted with `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` (`admin/dokploy-credentials.ts`). Verify, remove, status in Clients › Deployment. Application list picker in site settings.
- Legacy `DOKPLOY_URL`/`DOKPLOY_API_KEY` fallback only in non-production with the dev flag.

### Storage deletions

`storage_object_deletion` table: S3 object deletions are queued durably and drained by `drainStorageObjectDeletions` (survives row or org deletion and outages). See `docs/ASSET_RETENTION.md`.

### Email

Invitations use SMTP (`invitation-delivery.ts`). If sending fails the invitation is still created and the UI offers "Send again" and "Copy link".

### Webhooks

**None in CMS code.** `grep` for `webhook` in `apps/cms` finds nothing. `docs/INTEGRATIONS.md` describes webhooks only as a generic consumer pattern.

### Other background or scheduled work

- Heartbeat for readiness (`ops/heartbeat.ts`), metrics (`ops/metrics.ts`), readiness checks (`ops/health.ts`).
- AI SEO requests are on-demand, not background.

---

## 8. Authentication

Sources: `src/lib/auth.ts`, `src/lib/auth-providers.ts`, `src/server/auth/registration-gate.ts`, `src/server/security/*`, `src/server/admin/setup*.ts`.

- **Library:** Better Auth with the Drizzle adapter (`pg`), `twoFactor` plugin (issuer "Areca CMS", backup codes, passwordless allowed), `sso` plugin only when Microsoft is configured, TanStack Start cookies.
- **Email/password:** on by default (`AUTH_EMAIL_PASSWORD_ENABLED`).
- **Social:** GitHub, Google, Discord. Shown only when both client id and secret are set.
- **Microsoft Entra ID:** OIDC via `defaultSSO`, PKCE, scopes `openid profile email`. Connection is env-only. Runtime SSO management endpoints (`/sso/register`, etc.) return 404 `SSO_PROVIDER_MANAGEMENT_DISABLED`.
- **Account linking:** enabled; SSO trusts the IdP's `email_verified`.
- **Invite-only registration** (`registration-gate.ts`): a new user row is created only if no users exist yet (setup) or a pending, unexpired invitation exists for that email. Otherwise `databaseHooks.user.create` throws.
- **TOTP 2FA:** enrolled from Account. Enforced for agency admins through `requireAgencyAdmin` (`ADMIN_MFA_REQUIRED`). Comment in `auth.ts`: SSO and social sign-ins skip the TOTP challenge because the IdP is trusted to have done its own MFA.
- **2FA management** requires a recent session when the account has no password (`assertPasswordlessFresh`).
- **Step-up** (`step-up.ts`, `verify-step-up.ts`): sensitive `agency-fresh` actions need a TOTP re-verification in the last **10 minutes**. **5 failed** attempts lock step-up for **15 minutes**.
- **Setup** (`/setup`): `completeSetupFn` is public but refuses any caller without the setup token. The first user becomes agency admin. The token is `SETUP_TOKEN` or a generated per-process one logged while no user exists.
- **Invitations:** 7-day TTL (`INVITE_TTL_MS` in `admin/members.ts`).
- **Preview tokens:** 1 h TTL (`preview-token.ts`).
- **Site tokens:** build token (read manifest/snapshot) and schema token (write manifest). Stored as SHA-256 hashes. Rotation invalidates the old token.

---

## 9. i18n

- Paraglide with `messages/{en,nl,tr}.json`. Base locale `en`. Test `src/lib/i18n.test.ts` checks that every key exists in all three.
- Key prefix counts (en): editor 281, agency 171, admin 146, shell 93, golive 78, settings 77, server 74, sites 70, activity 67, auth 51, content 50, people 43, collection 42, library 35, account 28, overview 25.

---

## 10. Docs gaps and mismatches

### A. Features in code but missing or thin in docs

1. **Rate limits and lockouts**: 60/min for non-GET requests, 10/min uploads, 300/min site API, 30/hour AI SEO, 5-failure TOTP step-up lockout (15 min). None in CONFIGURATION or ADMIN_GUIDE.
2. **Step-up re-verification**: 10-minute window and lockout are not documented. ADMIN_GUIDE says only "may ask you to verify a fresh code".
3. **AI alt-text generation**: the AI SEO dialog also writes alt text for images missing descriptions, saving to the Library. ADMIN_GUIDE and CMS_GUIDE don't mention it.
4. **AI suggestion apply flow**: select/apply per suggestion, "text only" vs "with images", and the model line are undocumented.
5. **Urgent Go-live** ("skip the queue", `priority`): undocumented in both guides.
6. **Cancel build job** and **reconcile deployment** (owner) and the **uncertain deployment** agency resolution with reason and confirmation: ADMIN_GUIDE mentions this only in general terms.
7. **Languages**: en, nl, tr are supported UI languages. The guides say "interface language" with no list.
8. **Invitation details**: link valid for 7 days, "Copy link", "Send again", email-failure state, and role choice ("They'll join as").
9. **Social/SSO sign-ins skip the TOTP challenge** (code comment). Not documented.
10. **Preview token** (1 h TTL) and `/api/sites/preview`: CMS_GUIDE says preview works "when configured" without explaining the configuration.
11. **Delete-entry guard**: "Referenced by: {titles}" warning when other entries link to an entry. Not documented.
12. **Draft recovery in browser** (`draft-recovery.ts`): covered by CMS_GUIDE in one paragraph. Adequate.
13. **Typography (font choice) and invite sender name in branding**: covered by ADMIN_GUIDE. Font keys (`inter`, `manrope`, `figtree`, `system`) not listed.
14. **Content field types**: CONTENT_SCHEMA.md may cover, but no guide lists the 12 types or their limits (1,000 / 50,000 chars, 1 MiB entry, 256 KiB manifest).
15. **Scheduler behaviour**: `scheduled` entries publish by starting a release automatically ("Started automatically"); blocked while another job runs for the site. Not stated in CMS_GUIDE.
16. **Legacy redirects** (`/admin/*`, `/sites/:id/media`, `/team`, `/releases`, `/activity`): useful for bookmarks, not documented.
17. **Metrics** endpoint and its token: covered in OPERATIONS.md (verify); not in ADMIN_GUIDE.
18. **Editor cannot see Activity**: CMS_GUIDE says so. The code redirects `/sites/:id/activity` to a panel, so whether editors see the panel is **(unverified)**.

### B. Docs claims that don't match code (or are stronger than code)

1. **2FA "must keep it enabled"** (ADMIN_GUIDE, CMS_GUIDE): the account UI shows "Turn off" to every user with 2FA on, with no agency-admin check in `two-factor-section.tsx`. Enforcement is server-side, on the next admin call (`requireAgencyAdmin` → MFA_REQUIRED). The docs describe a stronger UI guard than exists.
2. **"Sign-ins then require an authenticator or recovery code"** (ADMIN_GUIDE): not true for GitHub, Google, Discord, or Microsoft sign-in. Those skip the TOTP challenge by design.
3. **`.env.example` vs CONFIGURATION.md**:
   - `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` is under `# Optional` in `.env.example`, but `env.ts` requires it. CONFIGURATION.md lists it as required.
   - `DOKPLOY_ALLOW_INSECURE_HTTP=true` and `ALLOW_PRIVATE_HEALTH_CHECKS=true` are **uncommented** in `.env.example`. CONFIGURATION.md says these must not be enabled on a public CMS. Copying the example to production enables them.
   - `S3_FORCE_PATH_STYLE=true` is uncommented, and `BETTER_AUTH_SECRET=change-me` is valid to the validator. Both are easy to ship by mistake.
4. **`LOG_LEVEL`**: OPERATIONS.md and CONFIGURATION.md document it as a CMS setting. It is absent from `env.ts`, so it is not validated and a typo silently falls back to `info` (`log.ts`). Documentation is correct, but it is not in the typed env.
5. **"Agency admins must keep at least one owner"** (ADMIN_GUIDE "Keep at least one trusted owner"): advice only, not enforced in code (`owner-invariant.test.ts` exists; check whether it enforces this for removal). **(unverified)**
6. **"Client Settings only renames the client or opens its delete area"** (ADMIN_GUIDE): not checked in detail. **(unverified)**
7. **"Invite link valid 7 days"** (CMS_GUIDE says "invitation expires after seven days"): matches `INVITE_TTL_MS`. No mismatch.
8. **"View activity" from client detail** (ADMIN_GUIDE): not verified in `client-screen.tsx`. **(unverified)**
9. **"Site token remains available on the Sites tab until you confirm"** (ADMIN_GUIDE): not verified. **(unverified)**

Items I checked and found to match: role table in CMS_GUIDE and ADMIN_GUIDE (matches authz matrix); "Demo never counts as production live"; production publish blocked without deployment target and health URL; previous production release stays live on failure; rollback creates a new build from the stored snapshot; Library types and 20 MB limit; public file URLs; `WORKER_*`, `REDIS_URL`, `S3_FORCE_PATH_STYLE` defaults; `SETUP_TOKEN` min 16 chars; `AI_SETTINGS_ENCRYPTION_KEY` optional with AI off without it; `METRICS_TOKEN` 404 when unset; token rotation invalidates old token; keyboard shortcuts (`g o/l/p/s`, `n`, `/`, `⌘.`, `⌘S`).
