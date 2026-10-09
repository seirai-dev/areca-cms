# Research notes 01: product guides (docs site input)

Scope: read-only extraction from the nine product-facing files below plus the root README. No repo files were edited. Cross-file contradictions and gaps are called out in their own sections.

Audience key used below: **EU** = end-user editor, **OWN** = client owner (editor role plus publishing), **AA** = agency admin, **DEV** = website developer, **OPS** = operator.

Notes on the repo: `docs/README.md` links to `SDK.md`, `API.md`, `CONFIGURATION.md`, `TROUBLESHOOTING.md`, `DEPLOYMENT.md`, `ASSET_RETENTION.md`, `HIGH_RISK_UPGRADE.md`, `DEVELOPMENT.md`, `OPERATIONS.md`, `RECOVERY.md`, `INTEGRATIONS.md`, `CAPACITY.md`, `UPGRADES.md`, `DECISIONS.md`, `DESIGN.md`, `AUTHZ_MATRIX.md`. All of these exist on disk. They were NOT read for this task, so anything depending on them is marked as unverified.

---

## Source 1: `docs/README.md`

- **Purpose:** Docs index and "which guide do I need" table. Also a "first successful publish" 5-step path.
- **Audience:** All (landing page).
- **Concepts:** client = organization; site; collection; entry; draft; ready; live.
- **Index table ("I want to... → Start here"):**
  - Set up Areca for the first time → ONBOARDING.md
  - Write, preview, publish website content → CMS_GUIDE.md
  - Manage clients, sites, people, branding, AI → ADMIN_GUIDE.md
  - Connect my own website to Areca → SDK.md
  - Define content types and fields → CONTENT_SCHEMA.md
  - Set up page titles, sharing cards, structured data → SEO.md
  - Deploy a customer website → DEPLOYMENT.md
  - Fix a problem → TROUBLESHOOTING.md
- **Your first successful publish (numbered):**
  1. Start the CMS and create the first admin (ONBOARDING.md).
  2. Create a client and site (ADMIN_GUIDE.md). Keep the site's token in the website's server/build environment.
  3. Define and push the website's content schema (SDK.md).
  4. Create an entry, preview it, mark it ready (CMS_GUIDE.md).
  5. **Go live**, then pull content into the website build. Local work: Demo mode. Production requires a deployment target and health URL (DEPLOYMENT.md).
- **Lifecycle terms (defined here):** Draft = editable. Ready = "an owner approved a version for the next release". Live = "a release containing that version successfully went through the publishing pipeline". "Saving a draft does not update the public website."
- **Mermaid flow:** Write a draft → Mark as ready → Go live → Immutable content snapshot → Website build pulls snapshot → Deploy and health check → Release becomes live.
- **Rendering model:** normal pages use build-time content; draft preview fetches from CMS; images still served by CMS asset endpoint unless the website copies them.
- **Reference table (includes guides not in this scope):** Concepts and architecture (ARCHITECTURE.md), SDK, API, Configuration, Permissions (AUTHZ_MATRIX.md), Operations, Recovery, Integration reliability (INTEGRATIONS.md), Asset retention, Capacity, Upgrades, High-risk upgrades, Development, Architecture decisions (DECISIONS.md), Design system (DESIGN.md), Implementation status (MVP_STATUS.md).
- Points to `../docker/README.md`, `../packages/site-sdk/README.md`, `../examples/demo-site/README.md`, `../PROJECT.md` (historical), `design/brief.md` (historical).
- **Screenshots:** `screenshots/current-collection.png` (Article collection with draft, ready, live entries).
- **Notes:** Says "Screenshots show representative screens". Points to `screenshots/README.md` for capture provenance.
- **Gotcha:** "Keep site tokens out of browser code and source control."
- **Stale / contradictions:** The "Your first successful publish" text tells users to "Define and push the schema (SDK.md)"; ONBOARDING instead uses `sync-manifest`. Both are valid, but the wording differs.
- **Gap:** "Draft preview" vs "live content" wording is good; no mention of Preview token expiry here.

## Source 2: `docs/ARCHITECTURE.md`

- **Purpose:** Concepts, data model, versions, publishing pipeline, snapshot format, preview, SEO/AI boundary, repo map.
- **Audience:** Developer, operator, AA (conceptual). Mixed.

### Organizations, sites, access
- Client = organization. One or more sites and memberships. Owner or editor membership applies to all org sites, not one site.
- Agency admins have access across organizations.
- Site has its own collections, entries, production URL, SDK token, preview secret, optional deployment target.
- Agency admins manage site settings and content types. Editors author drafts; owners also approve and publish. Exact rules: `docs/AUTHZ_MATRIX.md` (not read).
- Media library is scoped to the organization; sites of the same client share assets; unrelated clients cannot manage/select each other's assets.
- **Gotcha:** "Uploaded file URLs are public, including files attached to drafts; organization scoping protects CMS operations, not possession of a file URL."

### Content types belong to the website
- Collection describes fields and route, e.g. Articles at `/blog/$slug`.
- Developers declare collections in `areca.config.ts` and push the manifest. Agency admins can also manage content types in the CMS. Owners/editors fill fields.
- Pushing a manifest changes the CMS schema; does NOT build page components.
- Schema change may make older content invalid; review entries before next release.

### Version states table (entry can hold several at once)
| Version | Purpose |
| --- | --- |
| Draft | Current editable data and slug; draft preview uses these |
| Approved | Copied by **Mark as ready**; next release uses this |
| Scheduled | Frozen version and slug approved for a future time |
| Live | Version in the currently live publication snapshot |

- Editing a ready or live entry changes its draft. Mark ready again to approve.
- Scheduled version remains separate from later draft edits.
- Entry revision history restores authoring data; release rollback restores an entire site snapshot.
- **Stored status:** "Ready" is user-facing. Stored entry status uses `published` for approved content. Whether it is actually live depends on the live snapshot, not the status alone.
- Archive/delete does not instantly remove from deployed site; a successful new release must exclude it. References can block removal.

### Publishing a site (numbered, as documented)
1. Owner or agency admin requests **Go live**.
2. CMS validates enabled collections' approved content and due scheduled versions: required fields, slugs, references, assets, rich text, SEO, route collisions.
3. CMS saves immutable publication snapshot and its hash, queues a build job. New requests can replace queued work for same site.
4. Worker claims job, resolves client's deployment credentials, asks Dokploy to deploy the site's application.
5. Website build runs `areca pull`. CMS pins snapshot for the active deployment. Dokploy's `ARECA_SNAPSHOT_ID` build argument changes per publication to invalidate the cached pull layer; SDK itself does not use it to select a snapshot.
6. Worker waits for deployment and checks website health response against expected publication ID.
7. Success → publication live. Failure → previous live publication remains live.

- Production vs Demo: sites default to **Production** (needs deployment target and publication-aware health URL). Admin selects **Demo** in Settings › Deployment for local work. Demo publications: pullable for local builds, status `demo`, never count as production live, cannot be rollback targets.

### Worker
- Worker and scheduler run inside CMS server when `WORKER_ENABLED` is enabled. Work stored in PostgreSQL. DB claims, leases, heartbeats coordinate jobs. Only one active or uncertain deployment per site. Global concurrency configurable (variable name not given here).
- Lost deployment response → dispatch outcome uncertain; worker reconciles rather than re-dispatching. Read INTEGRATIONS.md and OPERATIONS.md before resolving manually.

### Releases and rollback
- A release records whole-site snapshot, build steps, logs, status.
- Rollback = restore a release that previously went live. CMS creates a NEW publication ID with the old snapshot's content and hash, queues a high-priority build. Uses configured website repo and deployment target. NOT a rollback of website source code, DB migrations, or provider settings.

### Snapshot format
- Collection arrays of entries with stable IDs, approved slugs, dates, resolved data.
- Image fields → URL/dimension/alt-text objects. References → collection/slug/ID objects. Rich text includes JSON, Markdown, a Markdown document, and HTML.
- Resolved SEO is an optional separate `entry.seo` object "for compatibility with older snapshots".
- `areca pull` writes one JSON file per collection plus `manifest.json` (publication ID, hash, creation time, counts).
- Assets are still external: retained publications protect referenced media from cleanup; public asset delivery depends on CMS/storage deployment.

### Preview
- CMS creates an expiring signed token scoped to site, collection, draft slug. Website preview route passes it to the SDK, fetches the draft, renders.
- Preview = server-side live CMS request; must return no-index and no-cache headers. Does not mark anything ready/live.
- **Gotcha:** anyone with a valid preview link can view that draft until expiry. Don't record real tokens in docs/screenshots.

### SEO and AI (summary here, detail in SEO.md)
- SEO settings saved with each entry's draft, follow same approval/release workflow.
- CMS resolves defaults, sharing metadata, structured data into `entry.seo`; website emits via SDK helpers. Summaries, FAQs, key takeaways need visible website rendering where appropriate.
- AI SEO optional. Agency admins configure encrypted OpenRouter key and models. Site's additional prompt guides suggestions. Generation proposes edits for review; does not publish.

### Repository map (table)
| Path | Responsibility |
| `apps/cms/src/routes` | CMS pages and HTTP API routes |
| `apps/cms/src/features` | CMS screen components and client interactions |
| `apps/cms/src/server/content` | Entries, schemas, validation, snapshots, preview |
| `apps/cms/src/server/publishing` | Releases, queue, scheduler, worker |
| `apps/cms/src/server/admin` | Clients, sites, members, branding, credentials |
| `apps/cms/src/server/security` | Authorization, two-factor step-up, encryption |
| `apps/cms/src/server/ai` | AI configuration and SEO generation |
| `apps/cms/src/adapters` | Deployment, storage, email integrations |
| `apps/cms/src/db`, `apps/cms/drizzle` | DB schema and migrations |
| `packages/site-sdk/src` | Schema helpers, CLI, content pull, preview, SEO rendering |
| `examples/demo-site` | TanStack Start integration and build/health examples |
| `docker` | Production Compose installation and recovery tools |
| `docker-compose.yml` | Local development infrastructure |

- **Screenshots:** none referenced.
- **Audience:** DEV, OPS, AA.
- **Stale / contradictions:**
  - Step 5 of publishing reads awkwardly: "The CMS pins the snapshot for the active deployment; the Dokploy's `ARECA_SNAPSHOT_ID` build argument changes..." Needs a rewrite before public use.
  - Says the repo map's `docker-compose.yml` is for "Local development infrastructure"; ONBOARDING and root README say it provides Postgres, Redis, RustFS, Mailpit. **Redis is never explained in any product doc read here.** Check whether it is used.
  - `Dokploy's` typo-like phrasing (see step 5).
  - "Scheduled" row says "Frozen version and slug approved for a future time"; MVP_STATUS says due version is published only after its release succeeds. See the scheduling contradiction under Source 7.

## Source 3: `docs/CMS_GUIDE.md`

- **Purpose:** Editor guide for owners, editors, agency staff. Write drafts, mark ready, go live, use Library, roles.
- **Audience:** EU (editor), OWN (owner).

### Find your workspace
- Workspace switcher at top of sidebar: recent sites and sites you can access. Client member can work across that client's sites. Agency admins can open the **Agency** workspace.
- **Search** = ⌘K (Mac) / Ctrl+K (other): finds pages and common actions.
- Phone: bottom tabs **Overview, Content, Library, More**.
- Site **Overview**: work needing attention, create shortcuts, recent edits, and (owners/admins) recent activity.
- Site sidebar: each content type, shared Library, allowed links.
- Screenshot: `screenshots/current-collection.png`.

### Draft, ready, live (status table)
| State | Meaning |
| Draft | Only CMS has latest changes |
| Ready | Owner marked current draft ready; included next time site goes live |
| Live | Current version in the live site release |
| Scheduled | Queued for chosen time |
| Archived | Kept in CMS, omitted from site |

- Saving does not publish. **Mark as ready** copies draft into release-eligible version. **Go live** publishes snapshot of whole site incl. all ready changes.
- Owners and agency admins can perform these; editors can create/edit/save/preview, and "publish controls explain why they are unavailable".
- **Edited since ready**: shown when draft changed since owner approved. Ready copy still used for site; ask owner to mark newer draft ready before next release.

### Create and edit an entry (numbered)
1. Open a content type (e.g. Articles), choose **New article**. Also: create tile on Overview, or sidebar **+** menu.
2. Fill fields. Large title field usually supplies title. Slug generated from title until edited; must be lowercase letters, numbers, hyphens; unique within its content type.
3. Rich text supports: headings, emphasis, links, lists, quotes, code, images, tables, dividers. Insert menu or `/` while editing. Image fields open the Library picker.
4. Changes autosave after a short pause. Top bar shows save status; **Save** or ⌘S / Ctrl+S saves immediately. New entry created once it has enough info for a valid slug.
5. Open **Details** to edit slug, structured fields, SEO info, status, revision history. **Preview** opens draft on site when preview configured.
- Screenshot: `screenshots/current-editor-seo.png` (Saved entry editor with Details panel).
- Entry history appears after first save. Owners and agency admins can restore a revision.
- **Local recovery copy:** if save cannot reach server, editor keeps local recovery copy in this browser and offers it on reopen. Review recovered draft before reapplying to latest saved version. (Only documented here; not in other guides.)

### Make changes live
- Owner can mark one or several entries ready from editor or collection list. In a collection, **Select** → bulk action bar: **Mark as ready**, **Move to draft**, **Delete**.
- Editor's action menu: **Mark as ready & go live now**, **Schedule**, and when relevant move back to draft, archive, delete.
- **Schedule:** freezes approved content and address at scheduling time. Editor shows **View approved scheduled version**; draft edits don't replace it. Uses selected time zone, runs release when due. Owners can cancel a scheduled version.
- **Go live** (site sidebar or Overview): panel shows changes included, release progress, errors, prior releases.
  - **Production:** builds and deploys latest snapshot, verifies deployed site reports the publication ID. Requires deployment target and health-check URL; otherwise publishing blocked. Previous successful production release stays live if new one fails.
  - **Demo:** creates clearly labeled demo publication; no production deploy or live verification; does not make site production-live.
- **Rollback:** owners request rollback from a prior successful release in the Go-live panel. Queues new high-priority build from that release's saved snapshot and content hash. Does NOT build from today's drafts or erase newer drafts. Failed rollback can be retried.
- Screenshot: `screenshots/current-releases.png` (Go-live panel with changes and release history).

### Keyboard shortcuts
- Account menu → **Keyboard shortcuts…** dialog.
- ⌘K / Ctrl+K search and commands; **g** then **o** Overview; **g** then **l** Library; **g** then **p** People; **g** then **s** workspace switcher.
- In a collection: **n** new entry. **/** focuses page search (or opens command palette if page has no search).
- In editor: ⌘S / Ctrl+S saves; ⌘. / Ctrl+. toggles Details. Single-key shortcuts pause while typing.

### Library
- Shared across all sites in a client. Accepts **JPEG, PNG, WebP, GIF, PDF**; **20 MiB limit per file**. Image fields select images; PDFs remain library files.
- Upload from Library, from an image field, or drop files onto Library page.
- Search by filename; open item to edit description (alt text) or open/copy file link. Header filter for image files without descriptions.
- Editors and owners upload and update descriptions. **Only owners and agency admins delete files.** File used by content or retained history cannot be deleted; remove references first.
- Screenshot: `screenshots/current-library.png`.
- **Gotcha:** uploaded files have public URLs including files attached to drafts; anyone with URL can read. Link to `DEPLOYMENT.md#media-privacy` (anchor exists).

### People and roles
- Owners invite from **People**. Several comma-separated emails; choose **Editor** or **Owner** for invitation. Pending invitations can be resent or revoked; roles changeable later. **Invitation expires after seven days.** Editors do not see People, Settings, or Activity.
- Role table:
  - **Editor:** create/edit drafts, preview, upload files, update descriptions. Cannot approve, schedule, archive, delete entries, restore revisions, publish, delete files, manage people.
  - **Owner:** all editor tasks + approve and schedule, archive/delete entries, restore revisions, run releases and rollbacks, delete unused files, manage client people and invitations.
  - **Agency admin:** all client and site capabilities + manage clients, sites, content types, agency access, branding, global activity, AI configuration. **Requires two-factor authentication.**
- Agency admins manage agency-wide access at **Agency › People**. Client members open all client sites.
- Screenshot: `screenshots/current-people.png`.

### Activity and account preferences
- Owners open site **Activity** from sidebar or activity panel: content, people, release actions. Agency admins: **Agency › Activity** (instance-wide).
- Account menu: **Light / Dark / Auto** appearance, interface language, keyboard shortcuts, **Account**, sign-out.
- Account: enable two-factor or regenerate recovery codes. Accounts without a required second factor can disable it; **agency admins must keep it enabled**.
- **Changing interface language does not translate authored content.**

### Phone
- Top workspace control to choose site; bottom tabs Overview / Content / Library / More. Content lists content types; More contains allowed pages. Drafts still autosave; Details for slug, fields, SEO, history. Publishing indicator in top bar opens Go-live panel.
- Screenshot: `screenshots/current-mobile-collection.png`.

### Help
- Release failed → open **Go live**, read failed release details or build log.
- Entry not on site → check it is marked ready and that a successful Go live completed after that change.
- Publishing action disabled → ask owner to check role.

- **Audience:** EU, OWN.
- **Stale / contradictions:**
  - "Changes save automatically after a short pause" here; ONBOARDING states exactly 2 seconds. Keep the exact number out of the CMS guide or confirm it.
  - Slug rule here is "lowercase letters, numbers, and hyphens"; MVP_STATUS gives the regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` (no leading, trailing, or doubled hyphens). Use the precise rule on the docs site.
  - "Demo mode, Go live creates a clearly labeled demo publication..." consistent with others.

## Source 4: `docs/ADMIN_GUIDE.md`

- **Purpose:** Agency admin setup and ongoing admin: clients, sites, site settings, deployment, access, branding, AI SEO, releases, activity.
- **Audience:** AA (primary), OPS.

### Screens
- Screenshot `screenshots/two-factor-authentication.png` (sign-in authenticator challenge).

### Create a client and site (prose)
- First admin created at `/setup` (ONBOARDING).
- Before Agency administration, enable 2FA from **Account**: confirm account when prompted, scan QR code (or save displayed secret), verify a current code, copy and store recovery codes. Sign-ins then require authenticator or recovery code. Sensitive actions may ask for fresh code.
- **Agency › Clients**: create client. Open client → **New site**. Set name and production URL. Save the site token shown in the connection step. **If you close the second step without confirming, it remains available on the client's Sites tab until you confirm you saved it.** (CONTRADICTS ONBOARDING; see below.)
- Client and its members share access to all the client's sites.

### Site Settings tabs
| Tab | Purpose |
| General | Site name, production URL, site deletion area |
| Deployment | Select **Production** or **Demo**; configure Dokploy app and health-check URL for Production |
| Developer | Site token, token rotation, project connection state, integration guidance. **Rotating a token immediately invalidates old token.** |
| AI | Site-specific writing instructions appended to agency's shared AI prompt |
| Content | Review, enable/disable, create, edit content types and fields |

- Client detail page tabs: **Sites, People, Deployment, Settings**. Client Settings only renames client or opens delete area. Client Deployment tab manages that client's Dokploy URL and API credential.
- Content types normally sync from site manifest. Agency can configure in **Settings › Content**: row switch to enable/disable, select row to edit fields and route, **New content type**. **Disabling keeps entries in CMS but excludes them from new site snapshots.**
- **Gotcha:** avoid deleting a site or org as cleanup shortcut: **site deletion archives content history; organization deletion removes that organization's data.**
- Screenshot: `screenshots/current-developer-settings.png`.

### Connect deployment
- Client's Dokploy connection under **Clients › [client] › Deployment** and verify.
- Site **Settings › Deployment**: select **Production**, choose target app, set health-check URL reporting the publication ID the deployed site received. Save. Production Go live blocked until app and health URL configured.
- Worker builds snapshot, requests deployment, waits for matching health check before marking production-live.
- Demo: select **Demo** in Settings › Deployment for local authoring. Demo releases labeled and never production live. **They do not establish that a public site deployed successfully.**
- Reference INTEGRATIONS.md for uncertain external deployment requests.
- Screenshot: `screenshots/current-deployment-settings.png`.

### Manage access
- **Site › People** or **Clients › [client] › People**: invite client users, change Owner/Editor, remove members.
- Owners: create/edit content, mark ready, schedule/manage entries, go live, roll back, manage Library deletion, manage client people and invitations.
- Editors: create/edit drafts, preview, upload, update descriptions; cannot mark ready, schedule, archive, delete entries, restore revisions, go live, delete files, manage people.
- Agency admins can open **Agency › People** to inspect accounts and grant/remove agency-admin access.
- "Keep at least one trusted owner for each client." Owner access is privileged. Agency-admin changes and destructive ops can require fresh authentication.

### Branding
- **Agency › Branding**: CMS name, logo, favicon, accent colour, interface font, invitation email sender name. Preview light/dark before saving. Sender name changes display name; sender address remains instance mail setting. **Reset to defaults** removes custom branding and uploaded images.
- Screenshot: `screenshots/current-branding.png`.

### AI-assisted SEO
- **Agency › AI**: connect OpenRouter provider, choose model, set agency-wide SEO prompt. API key stored encrypted and **never displayed again after saving**.
- Site-specific instructions: **Site Settings › AI**.
- "When configured, **signed-in site members** can request suggestions from an entry's SEO panel. The editor reviews and applies them; AI does not publish content." (Who may generate is unclear; see gaps.)
- Screenshot: `screenshots/current-agency-ai.png`.

### Releases and activity
- Agency overview summarizes sites needing attention. Site → **Go live** → release panel: snapshot, build steps, logs, failures, cancellation and rollback actions.
- Uncertain deployment: reconciliation tools preserve one-job-per-site boundary; agency admin may need to resolve an uncertain deployment **with an explicit reason after confirming the upstream deployment has stopped.**
- **Agency › Activity**: instance-wide audit log. Client detail page **View activity** opens agency log filtered to that client. Site activity gives site scope.

### Security and lifecycle
- Require 2FA for agency admins; individual accounts.
- Share site tokens only with connected site project. Rotate if exposed and update project environment at the same time.
- CMS files and snapshots retained while authoring history references them. See ASSET_RETENTION.md before deletion/cleanup planning.
- App admin doesn't replace infra backups, upgrade rehearsal, monitoring. See DEPLOYMENT, OPERATIONS, UPGRADES.

- **Audience:** AA, OPS.
- **Stale / contradictions:**
  - Token display: ADMIN_GUIDE says token "remains available on the client's Sites tab until you confirm"; ONBOARDING says "It is not shown again" and "Rotating…" . ONBOARDING §7 also says Developer tab shows the "read-only site token". So the token is viewable later in Developer settings. The "not shown again" claim is misleading. Resolve before publishing.
  - ADMIN_GUIDE says "Developer: Site token, token rotation, project connection state". Fine. ONBOARDING says Developer also shows schema-write token. Screenshot README warns older helper copy can lag.
  - "Organization deletion removes that organization's data" vs MVP_STATUS "cannot delete an org that still has sites". Compatible, but the docs should say it.
  - ADMIN_GUIDE: "Client detail page **View activity**" vs ONBOARDING "Agency › Activity (`/agency/activity?client=`)". Compatible.

## Source 5: `docs/ONBOARDING.md`

- **Purpose:** Zero-to-first-publish walkthrough with exact commands, URLs, UI labels, and expected results. Also Dokploy and troubleshooting tables.
- **Audience:** DEV (local setup), AA (first admin), EU (inviting, authoring). Mixed. Largest file (387 lines).
- **Stated conventions:** "PowerShell-friendly: do not chain with `&&`; run commands separately (or join with `;`)." Note: §1 uses `cp`, §8 uses `copy`.

### Prerequisites
- Docker Desktop (Postgres, RustFS/S3, Mailpit); **Node 24**; **pnpm 12** (`corepack enable`, `corepack prepare pnpm@12.8.1 --activate`); repo cloned.

### 1. Infrastructure (numbered commands)
1. `docker compose up -d`
2. `pnpm install`
3. `cp apps/cms/.env.example apps/cms/.env.local`
4. Edit `apps/cms/.env.local`: replace example `BETTER_AUTH_SECRET`; set `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` to output of `openssl rand -base64 32`. Keep it stable; required even before connecting Dokploy.
5. For local links/images/previews set:
   ```
   APP_URL=http://localhost:3000
   BETTER_AUTH_URL=http://localhost:3000
   ```
6. `pnpm --filter @areca/cms s3:init` (prints `Created bucket: areca` or `Bucket already exists: areca`)
7. `pnpm db:migrate` (applies migrations without dropping)
- Expected ports: Postgres 5432, RustFS 9000, Mailpit SMTP 1025, Mailpit UI 8025.
- `.env.local` gitignored.
- Dokploy later: `APP_URL` and `ARECA_CMS_URL` must be LAN URLs the Dokploy host can reach.

### 2. Optional empty CMS: `pnpm db:reset`
- **Destructive**: TRUNCATEs every app table (`RESTART IDENTITY CASCADE`) and empties the S3 bucket. Does not drop schema. Expected output: list of truncated tables and `Reset complete`. Confirm `DATABASE_URL` and `S3_BUCKET` point to throwaway resources. Never on shared/production.
- `pnpm --filter @areca/cms db:seed` gives Acme demo users instead.

### 3. Start CMS
- `pnpm --filter @areca/cms dev`; open http://localhost:3000. Empty `user` table redirects to `/setup`.

### 4. Super-admin at `/setup`
- URL http://localhost:3000/setup. Title **Welcome to Areca** — *Create the first admin account.* Setup token field.
- Steps: 1. **Setup token** (from CMS terminal output unless `SETUP_TOKEN` set). 2. **Name** (e.g. Kaan Kaya). 3. **Email** (e.g. admin@areca.local). 4. **Password** ≥ 8 characters (eye icon). 5. **Create admin account**.
- First agency admin prompted for TOTP 2FA; save recovery codes. Lands in **Agency workspace** (`/agency`).
- **Get your agency ready** checklist (5 steps): *Create a client*, *Add a site*, *Connect the site project*, *Invite the client*, *Go live*. Collapses to **All set**.
- `/setup` when signed out and already set up → `/login`. Signed-in → workspace.
- Workspace card at sidebar top (*Agency* or a site name) → switch: recent sites, all sites grouped by client, Agency workspace, **New site…**.
- Search ⌘K / Ctrl K: go to pages, create entries, Go live, Invite people, Upload, appearance/language, sign out.
- Account row: Appearance (Light · Dark · Auto), Language, **Keyboard shortcuts…**, **Sign out**.
- Phones: top bar + bottom tabs **Overview · Content · Library · More**.

### 4b. Whitelabel (optional)
- **Agency › Branding** at `/agency/branding`. Name replaces "Areca" in sidebar, tab, sign-in, setup, invitation pages.
- Logo and favicon uploaded to S3 under `branding/`, served via `/api/assets/file/…`.
- Colour: preset or own accent; re-tints selection, focus rings, links, switches, progress, "Ready" state. Primary buttons stay ink; status colours stay green/orange/red.
- Typography: curated font list or system font.
- Sender name = invitation display name; address still from `SMTP_FROM`.
- Live preview: sidebar, card, button, light and dark side by side. Save via floating **Save** pill.
- Settings in single-row `branding` table. **Reset to defaults** clears everything and deletes uploaded images.

### 4c. Sign-in methods (optional)
Configured only in `apps/cms/.env.local`; nothing in DB; restart CMS after edit.

| Method | Enabled by | Callback URL to register |
| Email + password | `AUTH_EMAIL_PASSWORD_ENABLED=true` (default) | — |
| GitHub | `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/github` |
| Google | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Discord | `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/discord` |
| Microsoft SSO (Entra ID) | `MICROSOFT_SSO_CLIENT_ID` + `MICROSOFT_SSO_CLIENT_SECRET` + `MICROSOFT_SSO_TENANT_ID` | `<BETTER_AUTH_URL>/api/auth/sso/callback/microsoft` |

- Disabled methods never appear and their endpoint is rejected server-side.
- `MICROSOFT_SSO_TENANT_ID` must be a real directory id; `common` cannot be validated. Entra accounts need a mail address (`email` claim).
- Registration stays invite-only. Provider sign-in succeeds only if the email already has an account (provider linked) or has a pending invitation; otherwise *This account is not allowed to sign in*.
- `/setup` bootstrap always accepts a password even with `AUTH_EMAIL_PASSWORD_ENABLED=false`; the first admin then signs in via provider with the same address.

### 5. Create a client
1. Agency sidebar **Clients** (`/agency/clients`) or checklist **New client**.
2. **New client**. 3. **Name** `Acme` → slug suggested `acme` (shown as whisper; **Edit** to change now; **cannot be changed later**). 4. **Create client**.
- Toast **Client created**; lands on `/agency/clients/<id>` with heading **Acme** and tabs **Sites · People · Deployment · Settings**.

### 6. Add a site and save its token
- Client page, **Sites** tab. 1. **New site** (two-step sheet). 2. **Site name** `Acme Website` → site key slug `acme-website`. 3. **Production URL** `http://localhost:3001` (default; previews open there). 4. **Create site**.
- Toast **Site created**, then step 2 **Connect your site**: site token with **Copy token**; Environment snippet (`ARECA_CMS_URL=…`, `ARECA_SITE_TOKEN=…`) with **Copy snippet**.
- "**Copy it now.** It is not shown again." Put in `examples/demo-site/.env.local`, click **I've saved it**. Rotating later: **Settings › Developer › Rotate token…** invalidates old token immediately (local `.env.local` and any Dokploy build args).
- Site cards: **Open** and **Settings**.

### 7. Site settings (agency admins) — `/sites/<id>/settings`
- **General**: name, **Production URL** (Preview opens `<productionUrl>/__preview/<collection>/<slug>?token=`), **Delete site…** in danger zone.
- **Deployment**: **Demo** for local work; Production: connect Dokploy and set publication-aware health check URL before going live. **Stop deploying…** clears target.
- **Developer**: site key, read-only site token and separate schema-write token, **Rotate token…**, **Site project** status (types synced from `areca.config`), **Quick start** snippet.
- **AI**: site instructions for optional SEO assistant.
- **Content**: label, key, route, field count, On/Off switch; **New content type**. Until any exist, Overview says *This site has no content types yet*.

### 8. Connect the demo site
- `examples/demo-site` = TanStack Start customer site. `areca.config.ts` declares `articles` (title, slug, excerpt, body, hero image, published at, category).
- Commands: `cd examples/demo-site`; `copy .env.example .env.local`.
- `.env.local` keys:
  ```
  ARECA_CMS_URL=http://localhost:3000
  ARECA_SITE_TOKEN=<paste the token>
  ARECA_SCHEMA_TOKEN=<paste the separate schema-write token>
  ```
- Schema token from **Settings › Developer**. Builds and pulls use `ARECA_SITE_TOKEN`; only schema publishing uses `ARECA_SCHEMA_TOKEN`. Keep schema token in trusted local authoring env, never a public build secret.
- Scripts load `.env.local` via `node --env-file-if-exists=.env.local`.
- From repo root: `pnpm --filter @areca-cms/site-sdk build` then `pnpm --filter @areca/demo-site sync-manifest`.
- Expected: exit 0; **Settings › Content** lists key `articles`, label **Articles**, route `/blog/$slug`; **Settings › Developer** says *1 content type synced from the site project*; sidebar CONTENT shows **Articles**.
- `pnpm content:fixture`: **no-CMS fallback only**. `prebuild`/`content:pull` do NOT fall back when `ARECA_CMS_URL` and `ARECA_SITE_TOKEN` are set; failed pull exits non-zero.
- Docker: `ARECA_CMS_URL` as build argument; `ARECA_SITE_TOKEN` as BuildKit build secret; adapter updates `ARECA_SNAPSHOT_ID`.

### 9. Invite people
- Site **People** (`/sites/<id>/people`), or ⌘K → **Invite people**, or Agency **Clients › Acme › People**.
1. **Invite people**. 2. **Email addresses** (comma-separated OK). 3. **They'll join as**: **Editor** (*Can write and edit drafts.*) or **Owner** (*Can also make changes live and manage people.*). 4. **Send invitation**.
- Pending list under **Invitations** (*Expires in 7 days*, **Revoke**).
- Mailpit: subject `Invitation to Acme`; link `/invite/<token>`, heading **Acme invited you**.
  - Signed out: **Name** and **Password** (email locked) → **Create account and join**. Auto-accepted. Provider buttons work.
  - Already signed in as that email: **Join Acme**.
  - Expired/used: *This link no longer works*.
- Member management: **Owner | Editor** switch per person (demoting yourself asks first; last owner can't be demoted); **⋯ › Remove from Acme…**. Agency: **Agency › People**.
- Role table in this file: Agency admin (`isAgencyAdmin`) / Owner / Editor (see Source 5 detail under "What each role can do"). Editors: publish controls stay visible but disabled with reason (*Only owners can publish…*).

### 10. Author articles
- Sidebar CONTENT lists types with entry count. **Articles** (`/sites/<id>/c/articles`), **New article** (or `n`).
- Editor is focus page: sidebar hidden; top bar: **← Articles**, save status, **Preview**, **⋯**, **Mark as ready** split button, **▥** (⌘.) toggles **Details**.
- Field table:
  | Field | Where | Notes |
  | **Title \*** | Canvas (big "Untitled") | Fills slug until slug edited |
  | **Excerpt**, **Body \*** | Canvas | Rich text: format bar while body focused (Paragraph/Heading 2–4/Quote/Code, Bold, Italic, Link, lists, **Insert** › Image · Table · Divider, undo/redo); `/` slash menu |
  | **Slug** | Details › Page | lowercase letters, numbers, hyphens; unique per collection; **Reset from title** while manual |
  | **Hero image** | Details › Fields | **Choose** opens Library picker; add description (alt text) |
  | **Published at**, **Category** | Details › Fields | Optional; not same as going live |
- **Autosave: 2 seconds after last change** (also on ⌘S, quiet **Save** button, leaving tab, navigating). New entry has no server row until title yields slug; status *Not saved yet — add a title*; then becomes `/c/articles/<id>`.
- Example titles: `Welcome to Acme`, `Shipping the first release`, `How preview works`.

### 11. Draft → Ready → Live
- Status vocabulary (pills, filters, editor, Go-live panel): Draft, Ready, Live, Scheduled, Archived (see table in file).
- Entry actions (owners and agency admins):
  - **Mark as ready** → `publishEntryFn`. Still not visible until site goes live.
  - **▾ › Mark as ready & go live now**.
  - **▾ › Schedule…**: quick chips *Tomorrow 9:00*, *Monday 9:00*, *In 1 hour*; date, time, timezone → **Schedule**. In-process worker publishes when due. **Cancel schedule** undoes.
  - **⋯**: **Move back to draft**, **Archive**, **Delete…**, copy link / ID, **Preview formatting**.
  - **Details › History**: revisions grouped by author; **Restore**.
- Collections support **Select** (Photos-style) for bulk Mark as ready, Move to draft, Delete.

### 12. Preview
- **Preview** (eye icon; enabled once saved with slug). URL: `http://localhost:3001/__preview/articles/<slug>?token=<signed>`.
- Demo site must run (`pnpm --filter @areca/demo-site dev`) with `ARECA_CMS_URL` in `.env.local`. Page shows **PREVIEW - draft content**; must send `X-Robots-Tag: noindex, nofollow`.

### 12b. Go live and releases
- Go-live tray at bottom of site sidebar: *Not live yet*, *3 changes ready* (**Go live**), *Going live…* (Queued → Building → Checking → Deploying), *Up to date*, *Last release failed* (**See what happened**). Phones: small pill in top bar.
- Steps: 1. mark each article ready. 2. **Go live** in tray (or Overview *changes ready* card).
- Demo: tray shows demo publication completed, labeled Demo. Production: *Going live…* while Dokploy builds and CMS verifies exact publication ID at health URL. Production needs deployment target.
- Go-live panel (click tray or `/sites/<id>?panel=golive`):
  - Status sentence and **What's changing** (ready entries linking to editors).
  - **Urgent — skip the queue** and **Go live**. Validation problems → *Fix these first* checklist linked to entries.
  - **Releases** timeline: *Went live*, *Failed*, *Replaced*, *Waiting…*. **Details** shows snapshot hash and build steps with **View log** (auto-refresh) and **Cancel** for queued jobs; earlier live releases offer **Restore this version** (rollback). **Show older** pagination.
- Publication status table:
  | `pending` / `building` | Waiting… / Going live |
  | `live` | Went live (current production release) |
  | `demo` | Demo publication; no production deployment |
  | `failed` | Failed — previous live release stays |
  | `superseded` | Replaced by newer release |
  | `rolled_back` | An earlier release was restored |
- Activity: **See all activity** on Overview, ⌘K → **Open activity**, **More** on phones, or `?panel=activity`. Agency: `/agency/activity?client=`.

### 13. Pull content and run
- `pnpm --filter @areca/demo-site content:pull`, then `pnpm --filter @areca/demo-site dev`.
- Writes `examples/demo-site/src/generated/content/` (`manifest.json` + `articles.json`); gitignored.
- Open http://localhost:3001/blog (three articles). `/blog/<slug>` renders title, excerpt, body HTML, hero image from `http://localhost:3000/api/assets/file/<storageKey>`.
- If image host is LAN IP → `APP_URL` in `apps/cms/.env.local` must be `http://localhost:3000`; fix, **Go live** again, re-pull.
- `pnpm dev` serves pulled files after successful pull.

### 14. How a site consumes content (developer)
```ts
import { readContent } from '@areca-cms/site-sdk/pull'
import { richTextDocument } from '@areca-cms/site-sdk'
import { Markdown } from '@tanstack/markdown/react'

const articles = readContent('src/generated/content', 'articles')
// article.data.body → <Markdown components={yourComponents}>{richTextDocument(body)}</Markdown>
// (TanStack Markdown AST; richTextHtml(body) is the static fallback)
// article.data.heroImage.url → CMS /api/assets/file/...
```
- `areca.config.ts` calls `defineSiteContent`. `areca pull` → `GET /api/sites/snapshot/current` with `Authorization: Bearer <token>`; writes JSON under `src/generated/content`.
- Preview: `getPreviewEntry({ token })` → `GET /api/sites/preview?token=`.
- Build pulls and draft previews contact CMS; visitors contact asset endpoint for CMS-hosted images.

### Deploying with Dokploy (after db:reset)
1. Create site again; copy NEW token. 2. Update Dokploy env, `ARECA_CMS_URL` build arg, `ARECA_SITE_TOKEN` build secret (`pnpm --filter @areca/cms dokploy:setup` or Dokploy UI). 3. `APP_URL` and `ARECA_CMS_URL` must be LAN-reachable. 4. `pnpm --filter @areca/cms dev:lan`. 5. Set deployment target (application id + health URL) on site Settings › Deployment.

### Troubleshooting table (ONBOARDING)
| Symptom | Fix |
| `areca pull` 404 / `No publication exists` | Mark an entry ready, Go live, wait for **Up to date**, pull again |
| `areca pull` 401 | Wrong/rotated token; update `.env.local` and Dokploy build secret |
| Images 404 / wrong host | `APP_URL` must be `http://localhost:3000` locally; Go live again |
| `/setup` says already set up / redirects to `/login` | User exists; sign in at `/login`; destructive reset only for throwaway instance |
| Worker not running / publication stuck `pending` | `WORKER_ENABLED` must not be `false`; restart `pnpm --filter @areca/cms dev`; expect log `[areca] publishing worker started` |
| Invite mail missing | Mailpit http://localhost:8025; `SMTP_HOST=localhost`, `SMTP_PORT=1025` |
| `pnpm sync-manifest` fails | CMS on :3000; `ARECA_CMS_URL`, `ARECA_SITE_TOKEN`, `ARECA_SCHEMA_TOKEN` in `.env.local`; use schema token not read-only site token |
| `prebuild` failed after setting env | Intended; fix CMS/token/publication, or unset vars and use `pnpm content:fixture` |

- **Env vars referenced:** `APP_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`, `SETUP_TOKEN`, `SMTP_FROM`, `SMTP_HOST`, `SMTP_PORT`, `WORKER_ENABLED`, `AUTH_EMAIL_PASSWORD_ENABLED`, `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET`, `MICROSOFT_SSO_CLIENT_ID/SECRET/TENANT_ID`, `ARECA_CMS_URL`, `ARECA_SITE_TOKEN`, `ARECA_SCHEMA_TOKEN`, `DATABASE_URL`, `S3_BUCKET`.
- **Commands referenced:** `docker compose up -d`, `pnpm install`, `pnpm --filter @areca/cms s3:init`, `pnpm db:migrate`, `pnpm db:reset`, `pnpm --filter @areca/cms dev`, `pnpm --filter @areca/cms dev:lan`, `pnpm --filter @areca/cms db:seed`, `pnpm --filter @areca/cms dokploy:setup`, `pnpm --filter @areca-cms/site-sdk build`, `pnpm --filter @areca/demo-site sync-manifest`, `pnpm --filter @areca/demo-site content:pull`, `pnpm --filter @areca/demo-site dev`, `pnpm content:fixture`, `node --env-file-if-exists=.env.local`.
- **Screenshots:** none referenced in ONBOARDING.
- **Audience:** DEV (§1–3, 8, 13–14), AA (§4–7, 9, Dokploy), EU (§10–12).
- **Stale / contradictions:**
  - **Token visibility:** "It is not shown again" (§6) vs ADMIN_GUIDE "remains available on the client's Sites tab until you confirm" vs ONBOARDING §7 Developer tab showing "read-only site token". Needs a single answer.
  - **Scheduling:** "Goes live by itself at the chosen time" / "in-process worker publishes when due" (§11) vs MVP_STATUS "due version is published only after its release succeeds". Behavior is subtle; the docs must say the scheduled version ships in a release that succeeds.
  - **Source of truth for content types:** §8 "The CMS owns the live schema after sync; the site file is the source you re-sync" vs CONTENT_SCHEMA "The local config is the version-controlled source ...". Also what happens if an agency admin edits a synced type in the CMS and a later push runs: not documented.
  - **Command naming:** `pnpm --filter @areca/demo-site sync-manifest` (§8), `pnpm sync-manifest` (troubleshooting, no filter; likely wrong from root), `pnpm exec areca manifest push` (CONTENT_SCHEMA).
  - **Terminology:** heading "Super-admin at `/setup`" vs everywhere else "agency admin". Also "client" vs "organization" (DB name) and "content type" vs "collection".
  - **Mixed package scopes:** `@areca/cms`, `@areca/demo-site` vs `@areca-cms/site-sdk`. Probably intentional, but confirm.
  - **Shell:** "PowerShell-friendly" but uses `cp`/`copy` and `openssl`; fine for PowerShell aliases but state it.
  - Preview header: "`X-Robots-Tag: noindex, nofollow`" here vs MVP_STATUS "`X-Robots-Tag: noindex`".
  - §12b "Going live... Queued → Building → Checking → Deploying" is a UI stage vocabulary not in ARCHITECTURE.
  - The "Get your agency ready" checklist and "Super-admin" wording are UI copy the docs must match exactly.
  - Uses `db:reset` as "optional"; it is destructive. Keep warnings prominent.
  - `WORKER_ENABLED` troubleshooting says "must not be `false`"; ARCHITECTURE says "enabled"; the default is not given.
  - Docker `Redis` appears in compose description (§1) but no product doc explains it.

## Source 6: `docs/CONTENT_SCHEMA.md`

- **Purpose:** Define collections/fields in `areca.config.ts`, push to CMS, how fields appear in snapshot JSON.
- **Audience:** DEV (primary), AA (content-type editing).
- **Screenshot:** `screenshots/current-content-schema.png` (Articles content type and field editor).

### Config example (verbatim)
```ts
import { defineSiteContent } from '@areca-cms/site-sdk'

export default defineSiteContent({
  siteKey: 'acme-site',
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
        { key: 'cover', label: 'Cover', type: 'image' },
      ],
    },
  },
})
```
- `siteKey` identifies site in Areca. Collection key (`articles`) = stable ID used in SDK calls and generated filenames. `route` documents pattern only; does not create route. `label` optional.

### Commands
- Push: `pnpm exec areca manifest push`. Needs `ARECA_CMS_URL`, `ARECA_SITE_TOKEN`, `ARECA_SCHEMA_TOKEN`. Manifest POST authorized by schema token; SDK client also requires site token at creation. CLI defaults to `./areca.config.ts` (path argument optional).
- Pull config from CMS: `pnpm exec areca manifest pull --config ./areca.config.ts`. **Replaces complete file** including comments and helper functions. If existing config has collections: shows added/changed/removed summary and asks confirmation. `--yes` skips prompt (automation). Commit or back up first.

### Field definitions
- Each field: unique `key`, editor-facing `label`, `type`. `required` default false. Optional `description` = editor guidance.
- Key rule: begins with ASCII letter; at most 64 ASCII letters, numbers, underscores, hyphens.

| Type | Use | Type-specific setting |
| `text` | Short plain text | — |
| `textarea` | Multi-line plain text | — |
| `richtext` | Formatted body | — |
| `image` | Uploaded image | — |
| `date` | Date without time | optional `after` field key |
| `datetime` | Date and time | optional `after` field key |
| `select` | One value from fixed list | `options: ['news', 'updates']` |
| `reference` | Link to entry in another collection | `collection: 'authors'` |
| `slug` | URL-friendly identifier | — |
| `boolean` | True/false | — |
| `number` | Numeric | — |
| `url` | Web address | — |

- Example:
  ```ts
  fields: [
    { key: 'category', label: 'Category', type: 'select', options: ['news', 'updates'] },
    { key: 'author', label: 'Author', type: 'reference', collection: 'authors' },
    { key: 'publishedAt', label: 'Published at', type: 'datetime' },
    { key: 'expiresAt', label: 'Expires at', type: 'datetime', after: 'publishedAt' },
  ]
  ```
- `after`: this value must be on or after the named date/datetime field. Reference points at collection KEY, not label. Select options are the allowed values.

### Keep in sync
- Push after local change. `manifest pull` as above.
- **What a push changes:** the full manifest. Creates/updates listed collections and enables them. **Collections omitted are disabled, including all collections if `collections` is an empty object.** Entries retained. Reintroducing key re-enables. Push does not migrate entry values or build routes.
- CMS ensures required `slug` field exists even when omitted from config. Duplicate field keys and unsafe reference/date-dependency identifiers rejected.
- Before removing a collection or changing required fields: check approved entries and references, update templates, verify a release on a test site. **A stale JSON file can remain after `areca pull`; use the latest generated manifest as the collection list.**

### Snapshot shape
- One `<collection-key>.json` file per collection. Items have entry metadata and field values under `data`.
- SDK value shapes: `ImageValue` (`url`, nullable `width` and `height`, `alt`, `mimeType`); `RichTextValue` (`markdown`, parsed `document`, `json`, static `html`); `ReferenceValue` (`collection`, `slug`, `id`).
- Entries have `id`, `slug`, `publishedAt`, optional resolved `seo`.
- Type example uses `SnapshotEntry`, `ImageValue`, `RichTextValue` from `@areca-cms/site-sdk`, `readContent` from `@areca-cms/site-sdk/pull`.

### Key restrictions
- Regex: `[A-Za-z][A-Za-z0-9_-]{0,63}`. Case-sensitive for data; reserved names checked case-insensitively: `manifest`, `__proto__`, `prototype`, `constructor`, Windows device names such as `CON`, `LPT1`. Rename invalid existing keys in CMS before sync/pull. SDK guards output paths and rejects symlink targets.

- **Stale / contradictions:**
  - Field type list here (12 types) is not in MVP_STATUS. MVP_STATUS lists text, textarea, rich text, images, dates, selects, references, slugs; it does not list `boolean`, `number`, or `url` as separate rows (though `url` validation is mentioned). Coverage of `boolean` and `number` is unverified.
  - Command name conflict with ONBOARDING (`sync-manifest` script vs `areca manifest push`).
  - "Push" semantics are destructive for omitted collections (disable). Docs must warn.
  - `route` "does not create a route automatically". Good, but ARCHITECTURE says "A collection describes its fields and route". Fine.
  - Keys: "Keys must begin with an ASCII letter" vs "Rename invalid existing keys in the CMS" — the CMS presumably can have keys created differently; unclear.
  - "The `slug` field type": ensure CMS adds required slug even if omitted. Consistent with MVP.

## Source 7: `docs/SEO.md`

- **Purpose:** SEO/GEO fields, AI suggestions, what ships in snapshot, editorial checks.
- **Audience:** EU (editing), DEV (rendering metadata), AA (AI config).
- **Screenshots:** `screenshots/current-seo-search.png` (Search title, description, focus keyphrase), `screenshots/current-editor-answers.png` (AI answers group expanded).

### Edit an entry's SEO
- Open entry → **Details › SEO & discovery**. Groups: search, social, answer-focused content, structured data, advanced. Autosaves. Preview shows title, description, URL including fallback values.

| Setting | Controls |
| SEO title and description | Search-result title/description. Empty → entry title and description or summary/body excerpt. Counters ~60 and ~160 chars = guidance, not validation |
| Focus keyphrase | Editorial note; main query |
| Canonical URL | Explicit canonical. Blank → derived from production URL, collection route, entry slug |
| Noindex / nofollow | Robots directives. Leave both off for normal public content |
| Social title, description, image | Open Graph. Fall back to search metadata; image falls back to entry's first image field |
| Twitter card | `summary` or `summary_large_image`; default follows image availability |
| Summary, takeaways, FAQ | Answer-oriented; summary and FAQ contribute to JSON-LD. Must be factual and supported by article |
| Schema type, about, author | Article/page type, entity and author details |
| Custom JSON-LD | Optional JSON object or array of objects appended. Valid, accurate only |

- **Limits:** SEO title max **300** chars; description max **1,000** (server-enforced). Counters are editorial. Custom JSON-LD max **20,000** chars; must parse as object or array of objects.

### AI suggestions
- If AI configured: **Generate with AI** in SEO panel. Opening dialog starts generation using current entry INCLUDING unsaved edits.
- Dialog shows selected model and whether it received text only or images.
- Lists only changed SEO suggestions: title, description, focus keyphrase, social title and description, summary, key takeaways, FAQ, schema type, about entities. Can suggest alt text for images without alt text.
- NOT generated: canonical URL, robots directives, social image, Twitter card, author, custom JSON-LD (editorial).
- Each suggestion shows current and proposed value. Changed metadata and eligible alt text selected by default. **Select all / Select none**. **Apply** updates only selected SEO fields in current draft and selected image descriptions in Library. **Cancel** discards. Generation does not save or publish.
- Prompt includes: site and page URL, content type, entry title, other populated fields, rich-text body (size limit), current SEO values, metadata for up to **four** associated images. Vision models receive resized image content; text-only models get no pixels. Image selection covers image fields, chosen social image, images embedded in rich text.
- Don't send confidential/personal info unless agency approved use with provider. System prompt: follow article language, avoid unsupported claims; editors remain responsible.
- AA configures provider, model, shared prompt at **Agency › AI**; site prompt at **Site Settings › AI**.
- **Rate limit: 30 requests per hour per user.** If the action is absent, AI may not be configured or available for account.

### What ships in a snapshot
- Per entry resolves: title, description, canonical URL, robots directives, Open Graph and Twitter values, author, summary, key takeaways, FAQ, JSON-LD.
- Title falls back to entry title. Description: supplied description → SEO summary → plain-text excerpt. Canonical inferred when production URL and collection route are valid. OG/Twitter use SEO/search fallbacks; images use chosen social image or first entry image.
- Snapshot also carries focus keyphrase and answer content. Site template must render metadata and JSON-LD: "rather than assuming the CMS itself serves page HTML." Preview responses marked `noindex`.

### Editorial checks
- Distinct, accurate titles and useful descriptions. Confirm slug and canonical match public URL. Noindex only after careful verification. Describe images in context; concise alt text. FAQ and structured data consistent with body. Review result preview, mark ready, release.

- **Stale / contradictions:**
  - SEO.md says "Summaries, FAQs... The summary and FAQ also contribute to generated JSON-LD" — fine. But ARCHITECTURE says "Summaries, FAQs, and key takeaways also need visible website rendering". Consistent intent.
  - **Who may generate AI suggestions is undocumented here**: ADMIN_GUIDE says "signed-in site members"; CMS_GUIDE is silent; AUTHZ_MATRIX not read.
  - "Apply" writes to the draft: whether it also saves/autosaves is not stated. Only "does not save or publish" refers to generation.
  - "Canonical URL... derived from the production URL" — ONBOARDING says preview opens at production URL (`http://localhost:3001` default). Consistent.
  - "Counters show useful targets (about 60 and 160 characters)" consistent with MVP.
  - Snapshot description fallback chain is not named elsewhere.

## Source 8: `docs/MVP_STATUS.md`

- **Purpose:** Audit of PROJECT.md "Suggested MVP" vs repo. Status done/partial/missing. Not really user-facing; a status page.
- **Audience:** OPS, DEV, product/roadmap readers. **Not suitable for end-user docs as-is** because it includes file paths and code references. Should be converted to a "Features / status" page or dropped.
- **Counts (verified):** done 39, partial 0, missing 1 (preview deployments, deferred), do-not-build 9 (correctly absent).

### Done (CMS): key facts
- Organizations: create/list/update/delete; cannot delete org with sites.
- Sites: client-scoped; separate read and schema-write tokens; Demo/Production; Dokploy target.
- Users and invitations: invite email, accept, revoke, last-owner guards; rejects duplicate pending invites, existing members, mismatched signed-in email on accept.
- Basic roles: Agency admin / org owner / org editor.
- Agency-managed collections: synced from manifest or created by agency admin; "customers cannot invent schemas".
- Text, textarea, rich text (Tiptap JSON canonical; allowlisted nodes/marks; HTML + Markdown export), images (asset id; snapshot URL `/api/assets/file/…`), dates (`date` + `datetime`; `after` enforces end ≥ start), selects (validated on save), references (must exist, be published, appear in snapshot), slugs (`^[a-z0-9]+(?:-[a-z0-9]+)*$`; unique per collection).
- Entry status: `draft | published | scheduled | archived`.
- Scheduled publishing: time zone and frozen approved data/slug stored. "The due version is published only after its release succeeds; later edits remain drafts."
- Revision history: list + restore; `entries.test.ts`.
- Basic media library: upload, alt text, type/size limits, dimensions via sharp, delete blocked when in use.
- Whitelabel branding: name, logo, favicon, accent, font, email sender name; `/agency/branding`.
- Audit log: admin/content/publish actions. Agency sees all; org owners see their org at **Activity**.
- Entry SEO: per-entry search/social, robots, canonical fallback, JSON-LD, answer fields in snapshots.
- AI SEO: optional OpenRouter; suggestions don't publish.

### Done (site integration)
- TanStack Start adapter (first official; core CMS doesn't import Start).
- Build-time loader: `areca pull` writes JSON under `src/generated/content`.
- `manifest.json` with publicationId, hash, createdAt, counts.
- Static route generation: prerender `/`, `/blog`, `/blog/<slug>`; `verify-prerender.ts`.
- Collection-to-route mapping (`articles` → `/blog/$slug`).
- Schema registration: separate schema-write token authorizes manifest POST; read token authorizes GET. CMS stores `lastManifest`, upserts collections.

### Done (publishing)
- Snapshot: immutable JSON + sha256; rich text exported as `{ json, markdown, document, html }`.
- Build queue: one job per site; coalesces queued jobs; in-process worker (`WORKER_ENABLED`).
- Priority: default **0**; **Urgent / rollback = 100**; worker `ORDER BY priority DESC`.
- Build logs: timestamped lines; per-step **View log**.
- Validation: required fields, slugs, references, missing assets, rich-text allowlist, route collisions, date `after`, `url` fields, link hrefs.
- Build failure: job/publication `failed`; previous live stays live.
- Dokploy adapter behind internal `DeploymentAdapter`; CMS UI never talks to Dokploy.
- Health checks: GET `healthCheckUrl` until `{ ok, publicationId }` matches.
- Rollback: eligible when `wasLive`; retries failed rollback.

### Done (preview)
- Signed draft preview: HMAC token scoped to site + collection + slug.
- Preview route in website; `X-Robots-Tag: noindex`.
- Token default TTL **1h**.
- Preview deployments: **missing** (deferred).

### Do not initially build (confirmed absent)
Visual page builder; arbitrary customer components (only allowlisted Tiptap nodes); GraphQL (no CMS GraphQL API); real-time collaborative editing; multi-framework (TanStack Start only); public plugins (internal `DeploymentAdapter` / `AssetStorageAdapter` only); general-purpose AI writing or chat; complex branching workflows; marketplace.

### Deferred
- Preview deployments (temp snapshot → preview target).
- Multi-language content / missing-translation checks. UI i18n (Paraglide) unrelated.
- Broken internal-link crawl (rich-text hrefs protocol-checked only).
- Search-engine ranking guarantees, crawler SEO audits, broken-link crawling.
- Media extras: thumbnails, focal point, CDN, usage graph UI.
- Separate build workers / incremental builds / per-site locking beyond in-process queue.

- **Stale / contradictions:**
  - `AssetStorageAdapter` mentioned here; ARCHITECTURE says `apps/cms/src/adapters` = "Deployment, storage, and email integrations" — consistent. Fine.
  - "Multi-language content" deferred, but the CMS UI supports English, Dutch, Turkish (root README; `apps/cms/messages/*`). Docs must say interface languages ≠ content languages (CMS_GUIDE says this).
  - MVP says Scheduled publish happens after release succeeds — contradicts ONBOARDING "goes live by itself at the chosen time". Choose one.
  - MVP lists "Preview token expiration default 1h"; no other doc gives TTL. Docs should state it (verify in code/config).
  - "Entry status uses `published`" (MVP) vs "Ready" (UI). Repeat: do not expose `published` to editors.
  - Summary counts consistent with table rows (verified by count).
  - Written as an audit of `PROJECT.md`, which the docs README calls historical. Consider not shipping this file as a public page; convert to "Features" page with user-facing wording.
  - MVP "Users and invitations ... rejects... accept with a mismatched signed-in email" consistent with ONBOARDING's "Already signed in as that email" flow.
  - `apps/cms/...` paths listed in MVP would leak internal file structure if copied verbatim.

## Source 9: `docs/screenshots/README.md`

- **Purpose:** Provenance and update rules for screenshots.
- **Audience:** Docs maintainers.
- **Current captures:** taken 9 October 2026 from local CMS build, as seeded agency admin; seed and test data present; no entries edited, settings changed, paid AI requests generated, or releases published.
- **Important:** "a screenshot's older helper copy can lag server rules (notably Production publishing and the separate schema-write token)". So some visible helper text in screenshots may be out of date. Use text from current guides, not screenshot text.
- Current captures table (14 files):
  | `two-factor-authentication.png` | Admin sign-in authenticator challenge, no code entered |
  | `current-collection.png` | Article cards and status filters |
  | `current-editor-seo.png` | Saved article editor with Details and SEO |
  | `current-seo-search.png` | Search title, description, focus keyphrase fields |
  | `current-mobile-collection.png` | Phone-size collection |
  | `current-editor-answers.png` | Editor with AI answers group expanded |
  | `current-developer-settings.png` | Site key, read token, schema-write token, connection commands |
  | `current-deployment-settings.png` | Production/Demo and deployment target |
  | `current-content-schema.png` | Content type field editor |
  | `current-agency-ai.png` | OpenRouter connection and model/prompt; credential masked |
  | `current-branding.png` | Branding and appearance preview |
  | `current-library.png` | Organization media library |
  | `current-people.png` | Client members and roles |
  | `current-releases.png` | Go-live review, failed-release explanation, release history |
- Images contain seeded/test titles and an existing failed release; example data only. Provider/model names are local selection, not recommendations.
- **Older reference images:** `*-light.png` / `*-dark.png` and `redesign/` predate this pass. The index says they are at "root" but the actual files are in `docs/screenshots/`: `content-`, `editor-`, `media-`, `overview-`, `releases-`, `settings-` `-light`/`-dark`, plus `redesign/` directory. Only `docs/DESIGN.md` (not in scope) references them. Not referenced by any file in scope.
- Update rule: wait for loading to settle; representative screen; keep passwords, bearer tokens, preview tokens, recovery codes, QR secrets, private customer content out; save PNG here; update alt text; record capture context here.

- **Stale / contradictions:**
  - Says older images are at the "root"; actually inside `docs/screenshots/`. Fix wording.
  - Notes the "separate schema-write token" as a known lag in older helper copy; must verify each screenshot's helper text against current behavior before reuse. The `current-developer-settings.png` description already mentions the schema-write token.
  - Screenshot README's "current" images show a seeded failed release; use them carefully (no pure happy path).
  - No alt text is stored with the images in the source docs beyond the Markdown alt text. Alt text in guides is short; there is no central alt text list.

## Source 10: `README.md` (root)

- **Purpose:** Repo front page: what Areca is, quick navigation table, publish flow, roles, repo layout, local dev basics, operations links.
- **Audience:** Everyone (DEV especially).
- **Description (verbatim lead):** "Areca is a build-time CMS for agency-managed websites. Editors write drafts; owners approve them with **Mark as ready**, then **Go live** creates a content snapshot and deploys the website. The website pulls that snapshot during its build using `@areca-cms/site-sdk`."
- **Get started table:** Install CMS locally and create first admin → ONBOARDING.md; Install published CMS image with Docker → `docker/README.md`; Write, preview, schedule, publish → CMS_GUIDE.md; Manage clients, sites, people, branding, AI → ADMIN_GUIDE.md; Connect a website using the SDK → SDK.md; Define content types → CONTENT_SCHEMA.md; Configure SEO and AI suggestions → SEO.md; Deploy and verify a customer website → DEPLOYMENT.md.
- **Publishing flow (code block):**
  ```text
  Draft → Mark as ready → Go live → Immutable snapshot
    → Website build pulls content → Dokploy deployment → Health check → Live
  ```
- Draft edits stay separate from approved and live versions. Scheduled content uses frozen approved version. Failed releases keep previous live; rollback redeploys a saved snapshot.
- **Production** requires deployment target and health response with expected publication ID. **Demo** supports local pulls without production deploy; labeled Demo; not live.
- Normal pages read built content; draft preview fetches from CMS. Media URLs publicly accessible including draft attachments; link `docs/DEPLOYMENT.md#media-privacy` (anchor verified present).
- **Workspaces and roles:**
  - Client orgs have sites, owners, editors. Site workspaces contain Overview, content types, Library, role-specific controls. Agency admins manage clients, sites, people, activity, branding, AI from Agency workspace.
  - Editors: drafts, preview, upload, image descriptions.
  - Owners: also approve, schedule, archive, delete, publish, roll back, manage client people.
  - Agency admins: all clients and site settings, content types, branding, integrations. **MFA required by default.**
- Interface: light/dark; English, Dutch, Turkish. Interface language does not translate content.
- **Repo table:** `apps/cms`, `packages/site-sdk`, `examples/demo-site`, `docker-compose.yml`, `docker`, `docs`.
- Dev basics: Node 24, pnpm 12; CMS on 3000, demo site on 3001. Seed users: `admin@areca.local`, `owner@acme.local`, `editor@acme.local`, password `password123` (local demo only; MFA may still be required). New empty instance uses `/setup` with first-run setup token.
- Operate: configuration, operations, recovery, upgrades, troubleshooting (`docs/TROUBLESHOOTING.md`). Browser tests clear configured DB and upload bucket; use isolated test stack; see DEVELOPMENT.md.

- **Stale / contradictions:**
  - Says "Install the published CMS image with Docker" but docs/README and ONBOARDING only mention `docker compose` for local dev. Fine; Docker is a separate track.
  - "Schedule" listed as a CMS task. OK.
  - The seed password `password123` appears in a public README. Acceptable only for local seed, but a public docs site should keep it explicitly local-only.
  - Root README: "English, Dutch, and Turkish" interface languages. CMS_GUIDE says "interface language" in the account menu. Consistent.
  - The README says the SDK is "ESM SDK" in repo table — fine.

---

## Cross-file contradictions (summary, ranked)

1. **Site token visibility.** ONBOARDING §6: "Copy it now. It is not shown again." ADMIN_GUIDE: token "remains available on the client's Sites tab until you confirm you saved it." ONBOARDING §7 Developer tab: "read-only site token" shown. Clarify when the token is shown and whether it can be re-read (only the schema-write token and rotation may be the real story).
2. **Scheduled publish behavior.** ONBOARDING §11 and CMS_GUIDE: "runs the release when due"/"publishes when due". MVP_STATUS: "due version is published only after its release succeeds". ARCHITECTURE: scheduled = "approved for a future time". Explain: a due schedule triggers a release, and the scheduled version ships only if that release succeeds.
3. **Content-type source of truth.** ONBOARDING §8 "The CMS owns the live schema after sync"; CONTENT_SCHEMA "The local config is the version-controlled source"; ADMIN_GUIDE: "normally sync from the site's project manifest" and agency can also configure in CMS. Behavior when both edit the same type is undocumented.
4. **Sync command name.** `pnpm --filter @areca/demo-site sync-manifest` (ONBOARDING §8), `pnpm sync-manifest` (ONBOARDING troubleshooting), `pnpm exec areca manifest push` (CONTENT_SCHEMA). Pick the canonical one and say what the script wraps.
5. **Slug rule.** CMS_GUIDE: "lowercase letters, numbers, and hyphens"; MVP_STATUS: `^[a-z0-9]+(?:-[a-z0-9]+)*$` (no leading/trailing/double hyphen).
6. **Preview headers.** ONBOARDING: `X-Robots-Tag: noindex, nofollow`; MVP: `X-Robots-Tag: noindex`; ARCHITECTURE: "no-index and no-cache headers". Verify actual headers before documenting.
7. **Terminology.** "Super-admin" (ONBOARDING heading) vs "agency admin". "Client" (UI, docs) vs "organization" (DB, ARCHITECTURE, MVP). "Content type" (Settings › Content, ADMIN) vs "collection" (CONTENT_SCHEMA, ARCHITECTURE). "Ready" (UI) vs `published` (stored status). "Release" vs "publication" vs "snapshot" used interchangeably. "Go live" button vs "deploy".
8. **Who can run AI SEO generation.** ADMIN_GUIDE: "signed-in site members". SEO.md and CMS_GUIDE say nothing about roles. Check AUTHZ_MATRIX.md (not read).
9. **Screenshot README** says older images are at "root"; they are in `docs/screenshots/`.
10. **ADMIN_GUIDE** says "Rotating a token immediately invalidates the old token" and ONBOARDING says the same. Consistent. Good.
11. **Editor autosave timing.** CMS_GUIDE: "short pause"; ONBOARDING: "2 seconds". Document exact number only if the code confirms it.
12. **Demo-mode Go live wording.** ARCHITECTURE: "Demo publications ... cannot be rollback targets"; CMS_GUIDE and ONBOARDING do not mention this. Good to add to the rollback page.

## Gaps and undocumented behavior (for the docs writers)

- **Redis:** `docker-compose.yml` includes Redis (ONBOARDING §1 says "Redis, RustFS and Mailpit"), yet no document explains its role. Check code before writing.
- **Global concurrency setting, worker lease durations, and default `WORKER_ENABLED`** are "configurable" but no variable name is given here (CONFIGURATION.md, not read).
- **Preview token TTL** is "default 1h" in MVP_STATUS only. Docs must confirm and say whether it's configurable.
- **Local recovery copy** on save failure: described only in CMS_GUIDE. Where it's stored, how long, and whether it is encrypted are not stated.
- **Library file limit / types:** "JPEG, PNG, WebP, GIF, PDF; 20 MiB per file" (CMS_GUIDE). MVP says "type/size limits" but gives no numbers. Verify against code/CONFIGURATION.md.
- **Invitation expiry**: 7 days. Consistent.
- **Two-factor step-up**: "Sensitive actions may ask you to verify a fresh code again" and "agency-admin changes ... can require fresh authentication" with no list of which actions.
- **Rollback scope:** not a rollback of website code, migrations, or provider settings (ARCHITECTURE). Put in a prominent warning on the Go live / releases page.
- **Uncertain deployment resolution:** agency admin "resolve with explicit reason after confirming upstream deployment stopped". Procedure lives in INTEGRATIONS/OPERATIONS (not read). Needs a link.
- **Site deletion** "archives content history"; org deletion "removes that organization's data". No restore or recovery story in product guides (RECOVERY.md, not read).
- **Entry revision retention** and restore scope (only authoring data) not quantified.
- **Asset deletion rules:** "file used by content or retained history cannot be deleted". "Retained history" depends on ASSET_RETENTION.md (not read).
- **Editors' view of revision history:** not stated. Owners and admins restore; read access unclear.
- **Which roles see "Edited since ready"** and whether it appears for editors is unstated.
- **Preview for scheduled entries** not documented.
- **Tokens:** where site token is rotated vs where schema token lives in Dokploy; documented in ONBOARDING only.
- **Health check contract:** response shape `{ ok, publicationId }` appears only in MVP_STATUS. ONBOARDING and ADMIN_GUIDE describe it in prose. The docs site needs the exact contract (it is developer-facing; API.md not read).
- **Website deployment env names:** ARECA_CMS_URL, ARECA_SITE_TOKEN (build secret), ARECA_SCHEMA_TOKEN, ARECA_SNAPSHOT_ID. The SDK doc (SDK.md) is out of scope but these should be cross-checked.
- **Languages:** UI in English/Dutch/Turkish; content language not supported (MVP deferred). A public docs site needs to state this in the FAQ.
- **Demo password `password123`** is documented in root README: keep only in a local dev page.
- **`manifest pull --yes`** and overwrite semantics are only in CONTENT_SCHEMA.
- **Schema removal** consequences: CONTENT_SCHEMA says check approved entries/references first; no procedure given.
- **Rich text format limits:** "allowlisted nodes/marks" (MVP) but the allowlist isn't listed anywhere in scope. Editors need to know what's supported (CMS_GUIDE lists: headings, emphasis, links, lists, quotes, code, images, tables, dividers).
- **Image alt-text requirement:** SEO says alt text suggestions. Is alt text required? Not stated.
- **Reference fields:** "must exist, be published" (MVP) but CMS_GUIDE says nothing on how to choose or on blocking; the "Reference picker" UI name is in MVP only.
- **Date `after` validation:** message text not given.
- **Snapshot fields:** `publishedAt` on every entry (CONTENT_SCHEMA) vs the `Published at` field in demo-site (ONBOARDING) — two different concepts with the same name. Explain in docs.
- **Demo-site article fields:** ONBOARDING says `articles` has title, slug, excerpt, body, hero image, published at, category. CONTENT_SCHEMA's example is a different shape (title, slug, body, cover). Clarify the example is illustrative.
- **Mermaid diagram and flow arrows** in docs/README use "Release becomes live" but ARCHITECTURE says "Live" only on success. Consistent.

## Items marked deferred or not implemented (do not present as available)

- Preview deployments (temporary snapshot → preview target): **missing / deferred** (MVP_STATUS).
- Multi-language content and missing-translation checks: **deferred** (MVP_STATUS). Only UI translation exists.
- Broken internal-link crawl across snapshot: **deferred**; rich-text hrefs protocol-checked only.
- SEO ranking guarantees, crawler-based SEO audits: **not promised / deferred**.
- Media extras: thumbnails, focal point, CDN, usage graph UI: **deferred**.
- Separate build workers / incremental builds / per-site locking beyond in-process queue: **deferred**.
- Not built: visual page builder; arbitrary customer components; GraphQL API; real-time collaboration; multi-framework (Start only); public plugins; general AI writing/chat; complex branching workflows; marketplace.
- Interface i18n (Paraglide) is shipped for UI but unrelated to content localization.

## Screenshot inventory (per file)

| Screenshot | Referenced from | Shows |
| `current-collection.png` | docs/README.md, CMS_GUIDE.md | Article cards, status filters |
| `current-editor-seo.png` | CMS_GUIDE.md, root README.md | Saved editor with Details/SEO |
| `current-releases.png` | CMS_GUIDE.md | Go-live panel, failed release, history |
| `current-library.png` | CMS_GUIDE.md | Organization Library |
| `current-people.png` | CMS_GUIDE.md | People and roles |
| `current-mobile-collection.png` | CMS_GUIDE.md | Phone-size collection |
| `two-factor-authentication.png` | ADMIN_GUIDE.md | Authenticator challenge |
| `current-developer-settings.png` | ADMIN_GUIDE.md | Site key, tokens, connection commands |
| `current-deployment-settings.png` | ADMIN_GUIDE.md | Production/Demo, target |
| `current-branding.png` | ADMIN_GUIDE.md | Branding and preview |
| `current-agency-ai.png` | ADMIN_GUIDE.md | OpenRouter connection, model, prompt (masked) |
| `current-content-schema.png` | CONTENT_SCHEMA.md | Articles content type fields |
| `current-seo-search.png` | SEO.md | Search title/description/focus keyphrase |
| `current-editor-answers.png` | SEO.md | AI answers group |
| `docs/screenshots/README.md` | docs/README.md, root? (cites itself) | Provenance |

- Not referenced in scope: none of the 14 current-* files are unused.
- Older `content|editor|media|overview|releases|settings-(light|dark).png` are referenced only by `docs/DESIGN.md` (outside this scope).
- No screenshot shows the Go-live tray, the editor Details History tab, Scheduling dialog, the AI SEO dialog (`ai-seo-dialog`), the invite-acceptance page, the sign-in with providers, or the Activity panel. These are candidates for new captures (only if the docs site needs them; capture rules are in screenshots/README.md).

## Audience map (quick view)

- **EU (end-user editor):** CMS_GUIDE (all); ONBOARDING §10–12; SEO.md editing and AI sections.
- **OWN (owner):** CMS_GUIDE "Make changes live", "People and roles"; ONBOARDING §9, §11–12b; ADMIN_GUIDE "Manage access" (partial).
- **AA (agency admin):** ADMIN_GUIDE (all); ONBOARDING §2–9, §4b–4c; SEO.md "AI" section; ARCHITECTURE "Organizations" and "Publishing".
- **DEV (website developer):** ONBOARDING §8, §13–14; CONTENT_SCHEMA (all); SEO.md "What ships in a site snapshot"; ARCHITECTURE "Snapshot format" and "Preview"; root README dev basics.
- **OPS (operator):** ONBOARDING §1–3 and Dokploy section and troubleshooting; ARCHITECTURE "Worker behavior"; MVP_STATUS (architecture status); root README "Operate and maintain".

---

## Proposed docs-site pages

Suggested top-level sections and pages (slugs are proposals). Each page cites the source file(s) above.

**1. Start here**
- `/` — Overview: what Areca is; the publish flow diagram; choose-your-guide table. (docs/README.md, root README.md)
- `/start/first-publish` — "Your first successful publish" 5 steps (docs/README.md)
- `/start/concepts` — Clients, sites, collections, entries; draft / ready / live / scheduled / archived (ARCHITECTURE.md, CMS_GUIDE.md)

**2. Set up Areca (operator and developer)**
- `/setup/local` — Local infrastructure and env (ONBOARDING §1)
- `/setup/first-admin` — `/setup`, 2FA enrollment, Agency workspace checklist (ONBOARDING §3–4)
- `/setup/whitelabel` — Agency branding (ONBOARDING §4b, ADMIN_GUIDE "Branding")
- `/setup/sign-in-methods` — Email/password, GitHub, Google, Discord, Microsoft SSO (ONBOARDING §4c)
- `/setup/reset-local` — Destructive `db:reset`, behind a prominent warning (ONBOARDING §2)
- `/setup/dokploy` — LAN URLs, dokploy:setup, dev:lan, deployment target (ONBOARDING Dokploy section; ADMIN_GUIDE "Connect deployment")

**3. Agency admin**
- `/admin/clients-and-sites` — Create client and site, token handling (ADMIN_GUIDE, ONBOARDING §5–6). Resolve token-visibility contradiction first.
- `/admin/site-settings` — General, Deployment, Developer, AI, Content tabs (ADMIN_GUIDE, ONBOARDING §7)
- `/admin/deployment` — Production vs Demo, Dokploy target, health URL (ADMIN_GUIDE, ARCHITECTURE "Publishing")
- `/admin/tokens` — Site token vs schema-write token; rotation (ADMIN_GUIDE, CONTENT_SCHEMA, ONBOARDING §8)
- `/admin/people-and-access` — Roles, invitations, agency people (ADMIN_GUIDE, ONBOARDING §9)
- `/admin/ai-seo` — OpenRouter, models, prompts, rate limit (ADMIN_GUIDE, SEO.md)
- `/admin/activity` — Audit log scopes (ADMIN_GUIDE, ONBOARDING §12b)
- `/admin/content-types` — Enabling and disabling content types from the CMS (ADMIN_GUIDE "Content")

**4. Content editors and owners (CMS guide)**
- `/cms/workspace` — Workspace switcher, Overview, sidebar, phone layout (CMS_GUIDE "Find your workspace", ONBOARDING §4)
- `/cms/keyboard-shortcuts` — Full shortcut list (CMS_GUIDE)
- `/cms/write-an-entry` — Create, fields, rich text, autosave, slug, Details panel (CMS_GUIDE "Create and edit", ONBOARDING §10)
- `/cms/statuses` — Draft, Ready, Live, Scheduled, Archived; "Edited since ready" (CMS_GUIDE, ONBOARDING §11)
- `/cms/preview` — Draft preview, what it means, link expiry (ARCHITECTURE "Preview", ONBOARDING §12)
- `/cms/mark-ready-and-schedule` — Mark as ready, schedule, cancel, bulk actions (CMS_GUIDE, ONBOARDING §11)
- `/cms/go-live` — Go-live tray, panel, release states, failures (CMS_GUIDE, ONBOARDING §12b)
- `/cms/rollback` — Rollback rules and limits (ARCHITECTURE "Releases and rollback", CMS_GUIDE)
- `/cms/library` — Upload, limits, alt text, deletion rules, public URLs (CMS_GUIDE "Use the Library", DEPLOYMENT media privacy link)
- `/cms/history-and-recovery` — Revision history and local recovery copy (CMS_GUIDE, ONBOARDING §11)
- `/cms/account-and-2fa` — Appearance, language, 2FA, recovery codes (CMS_GUIDE "Activity and account preferences", ADMIN_GUIDE "Account")
- `/cms/troubleshooting` — Editor-facing troubleshooting (CMS_GUIDE "When you need help")

**5. SEO and AI**
- `/seo/fields` — SEO panel fields and limits (SEO.md)
- `/seo/what-ships` — What is resolved into snapshots; site must render it (SEO.md, ARCHITECTURE "SEO and AI")
- `/seo/ai-suggestions` — Generate, review, apply; what's excluded; 30/hour (SEO.md)
- `/seo/checklist` — Editorial checks (SEO.md)

**6. Developers (website integration)**
- `/dev/install-sdk` — Install and CLI setup (SDK.md — out of scope; link only)
- `/dev/content-schema` — Collections, field types, keys, push/pull semantics (CONTENT_SCHEMA.md)
- `/dev/schema-sync` — `manifest push` / `manifest pull` / `sync-manifest` (CONTENT_SCHEMA, ONBOARDING §8)
- `/dev/reading-content` — Snapshot files, `readContent`, value shapes (CONTENT_SCHEMA "How fields appear", ONBOARDING §14)
- `/dev/build-pull-and-env` — `areca pull`, `ARECA_*` vars, `ARECA_SNAPSHOT_ID`, fixture fallback rules (ONBOARDING §8, §13; ARCHITECTURE "Publishing")
- `/dev/preview-route` — Preview route, signed token, noindex (ARCHITECTURE "Preview", ONBOARDING §12)
- `/dev/health-check` — Health contract `{ ok, publicationId }` (MVP_STATUS; needs API.md confirmation)
- `/dev/demo-site` — Walkthrough of `examples/demo-site` (ONBOARDING §8–13)

**7. Concepts and reference**
- `/reference/publishing-pipeline` — Steps, worker, queue, single-job-per-site, uncertain outcomes link (ARCHITECTURE "Publishing", "Worker behavior")
- `/reference/snapshot-format` — Snapshot and manifest.json (ARCHITECTURE "Snapshot format")
- `/reference/roles` — Editor / owner / agency admin matrix (ADMIN_GUIDE, CMS_GUIDE, ONBOARDING §9; link AUTHZ_MATRIX.md)
- `/reference/status-vocabulary` — UI label ↔ stored status mapping (ONBOARDING §11, §12b; MVP_STATUS)
- `/reference/feature-status` — Done / deferred / not built (MVP_STATUS rewritten for end users)
- `/reference/glossary` — Client/organization, site, collection/content type, entry, snapshot, publication, release, token

**8. Operations (link out for now)**
- Deployment, Configuration, Operations, Recovery, Integrations, Asset retention, Upgrades, Troubleshooting pages: source files not read in this pass.

**9. Troubleshooting (single hub)**
- `/troubleshooting` — Consolidate ONBOARDING's table, CMS_GUIDE "When you need help", ADMIN_GUIDE uncertain-deployment note; keep editor and developer symptoms separate.

---

## Open questions / gaps (for the docs owner)

1. **Token display:** Is the site token ever shown again after the connection step (ONBOARDING says no; Developer tab says "read-only site token" is displayed)?
2. **Scheduled publish:** Does a due schedule trigger a new release that must succeed before the scheduled version ships (MVP) or does it publish on its own (ONBOARDING)?
3. **Content-type ownership:** Who wins if an agency admin edits a synced type in CMS and then a push runs? Is the CMS edit overwritten?
4. **Redis:** What uses it, if anything?
5. **AI generation permissions:** Who can run "Generate with AI" (agency admin, owners, editors, any signed-in site member)? Check AUTHZ_MATRIX.md.
6. **Apply behavior:** Does "Apply" in the AI dialog autosave the draft, or wait for the usual autosave?
7. **Preview headers:** exact headers (`noindex` vs `noindex, nofollow`; no-cache?) and preview token TTL / configurability.
8. **Worker config:** variable names and defaults for `WORKER_ENABLED`, global concurrency, lease/heartbeat intervals.
9. **Library limits:** confirm 20 MiB and the MIME list in code or CONFIGURATION.md. MVP_STATUS only says "type/size limits".
10. **Local recovery copy:** storage location, retention, and whether it holds unsaved drafts only.
11. **Slug rule:** confirm the exact regex and whether the editor enforces it live.
12. **Revision access:** can editors view revision history, or only owners/admins restore?
13. **Edited since ready:** which roles see it? Does it trigger any warning at Go live?
14. **Rollback limits:** can an owner roll back to a release older than the latest? How many releases are retained (ASSET_RETENTION.md)?
15. **Uncertain deployment:** the reconciliation steps for agency admins need a full procedure (INTEGRATIONS.md / OPERATIONS.md).
16. **Sign-in:** Are provider sign-in options shown on the Account page? Only sign-in and invitation pages are described.
17. **Two-factor "fresh authentication"**: which actions trigger a step-up?
18. **Dates:** `publishedAt` (entry metadata, CONTENT_SCHEMA) vs a `publishedAt` field (demo-site `articles`, ONBOARDING). Clarify naming collision in docs.
19. **Field types:** confirm behavior of `boolean`, `number`, `url` in the editor (MVP_STATUS lacks rows for boolean and number).
20. **Rich text allowlist:** the exact list of supported nodes and marks for editors (MVP_STATUS says "allowlisted"; not enumerated).
21. **Required alt text:** is alt text optional for images, or required on publish?
22. **Interface vs content localization:** the FAQ should state the content is single-language; confirm nothing in the CMS handles locales.
23. **`pnpm sync-manifest`** at root: does it exist? Only the filtered `@areca/demo-site sync-manifest` is confirmed in ONBOARDING.
24. **Package scopes:** `@areca/cms`, `@areca/demo-site` vs `@areca-cms/site-sdk`: confirm they are final before publishing install instructions.
25. **Screenshots missing:** Go-live tray, Scheduling dialog, AI SEO dialog, Details › History, invitation acceptance page, sign-in provider buttons, Activity panel. Only the 14 current-* plus the two-factor image exist.
26. **`docs/screenshots/README.md` "root" claim:** older images are in `docs/screenshots/`, not repo root. Fix the wording.
27. **Deleting sites/orgs:** no product-level recovery story in these guides; RECOVERY.md must be linked and checked.
28. **Feature-status page:** MVP_STATUS contains repo paths and internal adapter names; rewrite for public audiences before publishing.
29. **Demo credentials:** `password123` appears in the root README. Confirm it is only seeded locally and never in a deployed environment.
30. **Preview scheduled entries:** not documented.
31. **Health-check contract:** the exact response shape and timeout are only in MVP_STATUS (`{ ok, publicationId }`).
32. **Reserved/limit numbers** that exist only in code: none are missing for SEO (documented: 300/1000/20000/30 per hour/4 images), but "four associated images" and "rich-text body size limit" lack a number for the rich-text limit.
