# Development environments

Status: agreed with the product owner on 26 Oct 2026 (second review the same day). Not built yet. This is the contract the later PRs implement. Delivered as four stacked PRs (see Rollout).

## Problem and workflow

Today every edit goes straight to the production site. When a customer asks for a change, the agency edits the live site's schema and content, and there is no safe place to try it first. The agency wants to try content changes together with code changes on localhost before anything reaches production.

The agency's workflow:

1. A new site is created for a customer. It is a normal site in Demo mode.
2. The agency sets it up with the `areca-quickstart` agent skill, adds collections, entries, images and languages.
3. The agency pulls the content locally and checks it. The customer approves.
4. The agency deploys on Dokploy with the production URL and switches the site to Production.
5. Later, the customer asks for a change (new entries, and maybe code or styling changes).
6. The agency opens the site's **development environment**. If it is stale, the agency resets it from production with one click.
7. The agency makes schema and/or content changes there, in the CMS UI, the CLI or over MCP.
8. The agency runs the website on localhost with `.env.local` pointing at the dev env, marks the dev entries ready and runs `areca pull`. No release is needed. Code changes are made at the same time.
9. The customer reviews screenshots and asks for small changes. The agency makes them in dev or in code.
10. The agency **pushes** the changes to production (CMS UI or MCP). Optionally the agency also goes live, which starts the production build. The build pulls production content and the new code.

The agency edits the CMS about 90% of the time. Customers email change requests.

**The dev env is a throwaway sandbox.** Nothing important lives only in dev. Creating, resetting and deleting it is cheap, with one plain confirm and no step-up. Everything that writes to production keeps full safeguards.

## Vocabulary

- **Production site**: a site with `environment = 'production'`. This is every site that exists today.
- **Development environment** (dev env): a linked site with `environment = 'development'`. It belongs to exactly one production site, through `parent_site_id`. It is shown to agency admins as "Development", with a "Dev" tag.
- **Fork**: creating the dev env by copying production's schema and ready content.
- **Reset from production**: throwing away everything in the dev env and forking again. (Called "refresh" in code and MCP: `refresh_from_production`.)
- **Push**: copying chosen dev changes into production (schema, languages, entries, sections, archives).
- **Copy to production**: pushing one entry or section, as a draft.
- **Baseline**: the state of an item when it was last forked or pushed. Used to tell what changed in dev and what changed in production.
- **Origin**: the production entry a dev entry was forked from.
- **Live pull**: an `areca pull` with a dev token. It reads the dev env's current ready content directly, without a publication.

Other vocabulary follows `docs/DECISIONS.md` and `docs/ARCHITECTURE.md`.

## Decisions

These are settled. They are recorded here, not reopened.

1. **Shape: a linked site.** A dev env is a real `site` row, marked as a development site, linked to its production site. It reuses all per-site machinery: its own site token, its own schema token, its own preview secret and its own MCP connector at `/api/mcp/<slug>-dev`. It is not an `environment` column added to every table.
2. **New client sites are normal sites.** A brand-new client site is a normal site in Demo mode. The agency edits it directly until its first go-live.
3. **Visibility: agency admins only.** Client owners and editors never see a dev env: not in the site list, the site switcher, notifications, activity, dashboards, MCP access, Connect AI or any guard. Membership is per organization today, so every site-scoped check goes through one helper that tests the dev flag.
4. **Exactly one dev env per production site, permanently.** All developers share it. The slug is `<slug>-dev` (collisions: see Edge cases). Deleting the production site deletes its dev env too.
5. **When it can be created.** The Development tab and the Create action are shown only when the production site is in Production mode or has gone live at least once. (The server rule is only "the site is a production site, not a dev env".)
6. **Throwaway lifecycle.** Create, Reset from production and Delete are one click with a plain confirm dialog. No fresh step-up. No type-to-confirm. Dev content is **not** archived to `deleted_content_archive` on reset or delete; dev rows are simply deleted. The reset dialog states how many unpushed changes will be lost.
7. **Always Demo, no releases.** A dev env can never switch to Production and never has a deployment target. It has **no publications and no builds**. The Go live tray, pill and panel are hidden on a dev env. `areca pull` with the dev token builds the snapshot on the fly from the dev env's current ready content (live pull). Pinning a publication (`?publicationId=`, `--publication`, `ARECA_SNAPSHOT_ID`) returns 400 on a dev token: "Development environments have no releases. Pull without a publication id."
8. **No scheduling in dev.** Scheduling is refused in dev (UI hidden, server refuses, `schedule_entry` and `cancel_schedule` not listed on dev connectors).
9. **Fork copies.** Schema (collections and sections, including disabled ones, with all their columns), site languages, `ai_prompt`, and every production entry's ready version (`published_data`) as ready in dev. Unfinished production drafts are not copied. Not copied: deployment target, Dokploy credentials, `production_url`, publications, builds, revisions, scheduled versions. Assets are organization-scoped, so the media library is shared and nothing is duplicated. Images uploaded in dev go into the shared library.
10. **Dev preview URL.** The dev env has its own editable **Preview URL** (stored in `site.production_url` of the dev row), default `http://localhost:3000`. Preview links in the dev editor use it with the dev preview secret, so drafts open on the agency's local site.
11. **Origin and baseline.** Each forked entry records its production entry id (origin), its content at fork time (baseline), and production's `content_version` at fork time. Entries created in dev have no origin. They become new production entries on push. References between entries are mapped through origin ids.
12. **Content version counter.** `entry.content_version` (new, on every site) goes up by one on **every** write to an entry row: draft save, ready, unpublish, archive, unarchive, schedule, cancel schedule, restore, language stamping, field purge, worker flips of scheduled entries, global upsert and discard. This is what detects "changed in production since the fork". `draft_version` keeps its current meaning.
13. **Push mirrors dev.** After a push, the production entry matches the dev entry: production's ready version (`published_data`, `published_slug`) becomes dev's ready version (validated strictly, as `publishEntry` does), and production's draft becomes dev's draft. A dev entry that is a draft only (never ready in dev) lands as a production draft only, and its production ready version is left as it was. If strict validation of a ready version fails in production (for example a newly required language), the draft is still written, ready is skipped, and the item is listed as a warning.
14. **Push screen.** One list of everything changed in dev since the fork or the last push, all ticked by default. The list covers schema changes, the language setting, new entries, changed entries and sections, and entries archived or deleted in dev (these **archive** the production entry; a push never hard-deletes production content).
15. **Needs attention, no dialog stacks.** Items that are risky to production sit in a **Needs attention** group at the top of the push screen. Each has an inline two-way switch in its row: **Skip** (default) or **Apply**. No pop-up confirm dialogs. Push is never blocked by undecided items: skipped is the default. Needs attention covers:
    - conflicts (production changed since the baseline; Apply = overwrite with dev);
    - schema removals that drop production content (Apply = remove and archive the dropped values; the row says how many values). A removed collection or section is **disabled** in production and its entries are archived; rows are kept, never deleted by a push. A removed field is purged from production entries on Apply; until then the entries keep production's values (see Push, step 6);
    - main-language changes (the row says how many entries get stamped);
    - production entries with a scheduled version ("Scheduled in production"; Apply is disabled; resolve the schedule first);
    - production entries deleted after the fork (Apply = recreate as a draft);
    - a URL that another production entry holds, or that another entry of the same push holds (main slug, or a localized `$i18n.<locale>.$slug`): "slug-taken". Apply is disabled; the URL must change in development.
16. **Push confirmation.** The push button shows the summary ("Push 12 changes · 2 skipped"). Clicking it pushes. The only extra step is the fresh 2FA step-up when the session is not fresh. There is no extra confirm dialog.
17. **Go live after push.** An option on the push screen, off by default. The browser remembers the user's last choice (local storage). It needs the go-live permission and starts the production build after the push commits.
18. **Copy to production as draft.** A "Copy to production as draft" action in the dev entry editor menu (and for sections) and an MCP tool copy one item. The copy becomes the new **draft** of the matching production entry. The live version stays as it is. Blocked if the production schema for that collection does not match the dev schema ("Push the schema first"). All languages are copied. References are mapped; unmappable references are cleared and listed as warnings. Conflicts are refused unless the caller passes `overwrite`.
19. **Bulk actions on normal sites.** A server-side bulk action (ready, draft, archive, delete) returns a result per id. The collection list's existing bulk bar uses it and gains **Archive (N)**. Per-action permissions are unchanged. The MCP `mark_ready` tool accepts several ids.
20. **MCP.** Reset, push and copy act on the dev connector, on its linked production site, for agency admins only. Creating the dev env is on the production connector. `get_site_info` reports `environment`, and on a dev site the production slug; on a production site with a dev env, it reports `devEnvironment: { slug, connectorUrl }`, and the server instructions say "Make changes in the development environment, then push." Production writes over MCP are **not** blocked.
21. **Local project.** `.env.local` points at the dev env's site token, so `areca pull` reads dev. Deployed builds use the production token. To check production locally, swap `ARECA_SITE_TOKEN` (and `ARECA_SCHEMA_TOKEN` for code-first sites) for the production values. `siteKey` in `areca.config.ts` is informational; the CMS uses the token's site. No SDK change in v1.
22. **Audit.** Fork, reset, push (with item counts), copy, rename and delete are written to the audit log. Every row written for a dev env, and every `dev_env.*` row, is stored with `audit_log.agency_only = true`, and client activity filters on that flag. Dev audit rows are hidden from non-admins, also after the dev env and its `site_id` are deleted. No notification events are created for dev envs.

## Non-goals

- Several dev envs per production site.
- A non-destructive "merge production changes into dev". Reset replaces dev completely.
- Content promotion without review. Push always shows a list the agency reviews.
- Dev envs for sites that never went live.
- Client-user access to dev envs.
- A visual diff of entry content. The push list shows which fields changed.
- Renaming collections as a special case. A rename is a remove plus an add.
- Pushing site-level settings (AI prompt, URLs, deployment) back to production.
- A push history drill-down. v1 shows a simple list.

## Data model

Migrations `0036_dev_environments` and `0037_audit_agency_only` (the latter adds `audit_log.agency_only`, see below).

### `site`

| Column | Type | Notes |
|---|---|---|
| `environment` | `text not null default 'production'` | `'production' \| 'development'` |
| `parent_site_id` | `text null` → `site.id` on delete cascade | Set only on dev envs. Partial unique index `where parent_site_id is not null`. |
| `schema_baseline` | `jsonb null` | Dev envs only. The production schema at the last fork or push. Same shape as `SiteManifest` plus disabled collections and sections (see "Schema snapshot"). |
| `last_forked_at` | `timestamptz null` | Dev envs only. Last fork or reset. |
| `last_pushed_at` | `timestamptz null` | Dev envs only. Last push or copy. |

Check constraints (backstops; the app checks the same rules first):

- `environment = 'production' or (parent_site_id is not null and publishing_mode = 'demo' and deployment_target is null)`
- `environment = 'development' or parent_site_id is null`

### `entry`

| Column | Type | Notes |
|---|---|---|
| `content_version` | `integer not null default 1` | Bumped on every write (Decision 12). All sites. |
| `origin_entry_id` | `text null` | Production entry id. **No foreign key, on purpose**: if the production entry is hard-deleted, the link must survive so the next push does not create a duplicate. |
| `origin_baseline` | `jsonb null` | `{ slug, data, publishedSlug, publishedData, status }`: the dev-side content at the last fork or push. Used to see what changed in dev. |
| `origin_content_version` | `integer null` | Production `content_version` at the last fork or push. |

Origin fields are only written on dev envs.

### `audit_log` (addition)

| Column | Type | Notes |
|---|---|---|
| `agency_only` | `boolean not null default false` | Set by `audit()` from the site's environment, or `true` for any `dev_env.*` action. Client activity filters on `agency_only = false` and does not need the site join, so the rows stay hidden after the dev env is deleted (its `site_id` becomes null). Migration `0037_audit_agency_only` backfills rows whose site is a dev env today, and `dev_env.*` rows. |

### `environment_push` (log)

| Column | Type | Notes |
|---|---|---|
| `id` | `text` | Same id helper as other tables. |
| `dev_site_id` | `text null` → `site.id` on delete set null | |
| `production_site_id` | `text` → `site.id` on delete cascade | The history list lives on the production site. |
| `kind` | `text` | `fork`, `refresh`, `push`, `copy` |
| `actor_id` | `text null` → `user.id` on delete set null | |
| `counts` | `jsonb` | For example `{ schema: 2, new: 3, changed: 5, archived: 1, skipped: 1, warnings: 0 }` |
| `items` | `jsonb` | Item ids, kinds, decisions, and the production id each item wrote to. |
| `created_at` | `timestamptz` | |

### Migration notes

- All new columns are nullable or have a default. Existing rows need no backfill.
- Drizzle schema in `apps/cms/src/db/schema.ts`, SQL in `apps/cms/drizzle/0036_dev_environments.sql`, journal and snapshot updated with `drizzle-kit generate` (then hand-add the check constraints and the partial index if drizzle does not emit them).
- `0037_audit_agency_only` adds `audit_log.agency_only` with a default of `false`, then backfills `true` for rows of dev sites and `dev_env.*` actions. Rows of a dev env that was already deleted before this migration keep `site_id` null and are not recoverable as agency-only; the branch is unreleased, so nothing in production has them.

## Server

New module: `apps/cms/src/server/dev-env/` (pure plan logic in files without database imports, so it can be unit-tested).

### Visibility helper

- `assertSiteVisibleTo(session, site)` in `apps/cms/src/server/security/site-visibility.ts`. A dev site requires an agency admin (with MFA, as `requireAgencyAdmin`); otherwise NotFound. Any other site keeps today's checks.
- The copied `requireSiteAccess` helpers (`server/fn/content.ts`, `server/fn/publishing.ts`) and the admin site lookups call it. `requireMcpSiteAccess` calls it. Server functions that take a `siteId` run the access check (org membership) **before** any check that depends on the site's settings, such as the language list (`generateEntrySeoFn`, `translateContentFn`). Otherwise a caller could probe a hidden site's languages.
- Assets (`server/fn/assets.ts`): `originSiteId` names the uploading site, which can be a dev env. Only agency admins (with MFA) receive it. Other callers get `null`, because nothing in the client reads it.

### MCP connector for a dev env (`server/mcp/http.ts`, `server/mcp/discovery.ts`)

A dev env's connector is `/api/mcp/<slug>-dev`. The rule is: **any caller who is not an agency admin gets the exact response a missing slug gets** (`404 {"error":"Site not found"}`, same headers and body), in every case where the caller is known.

| Caller | Response |
|---|---|
| No credential, or a malformed one | `401` with `WWW-Authenticate` pointing at the protected resource metadata, same as production. OAuth needs this to start, and the server cannot tell an admin from a client before it has a credential. |
| A personal key or OAuth token that is invalid, expired or revoked | `401`, same as production. |
| A valid credential for another site (personal key or OAuth resource) | `404`, as a missing slug. |
| A valid credential of a non-admin (token without the MCP scope, connection gone, live role lost) | `404`, as a missing slug. |
| A valid credential of an agency admin | Normal behaviour. A key for another site is `404` too. |
| Admin without two-factor auth | `403 mfa_required`, as production. Only agency admins can get this response. |

Discovery (`/.well-known/oauth-protected-resource/api/mcp/<slug>-dev`) stays on so OAuth works. For a dev env it returns `resource_name: "Areca site"` (not the dev name) and `Cache-Control: no-store`.

**Trade-off (accepted).** An unauthenticated request to `<slug>-dev` gets a `401` and the discovery document gets a `200`, where an unknown slug gets a `404`. So anyone can tell that a `-dev` slug exists. The slug is predictable (`<slug>-dev`), so this is not secret. The dev env's name, its contents and any authenticated access stay hidden. Removing the leak would mean answering `401` for unknown slugs too, which changes production behaviour, so it is not done here.
- Site list (`server/fn/me.ts`): the client branch adds `environment = 'production'`. The agency-wide branch keeps dev envs, with `environment` and `parentSiteId` in the result so the switcher can nest them.
- Notifications: triggers skip dev sites entirely.
- Activity: queries that return audit rows filter `audit_log.agency_only = false` for non-admins (`clientVisibleAuditFilter`). The flag is written by `audit()`, so it does not depend on the site join.
- Org-level counts and dashboards (`server/fn/home.ts`, `overview.ts`, agency screens) exclude dev envs for non-admins; for admins, they are not counted as separate client sites.

### Fork (create dev env)

Input: production site id. Caller: agency admin (no step-up).

Refused when the site is not a production site, or already has a dev env.

In one transaction (`lockOrganizationForMutation` first, as `createSite`):

1. Lock the production site row (`FOR UPDATE`), and take the production advisory lock (see Locking).
2. Slug: `<slug>-dev`; if taken, `<slug>-dev-2`, `-dev-3`, and so on.
3. Insert the dev site row: `name` = `<production name> (dev)`, `environment = 'development'`, `parent_site_id`, `publishing_mode = 'demo'`, `deployment_target = null`, `production_url = 'http://localhost:3000'`, new site token, schema token and preview secret (same helpers as `createSite`), `languages` and `ai_prompt` copied.
4. Copy collections and sections (`fork-copy` routine, shared with reset): every column, including `enabled`.
5. Copy entries: skip `archived`; skip collection entries never ready (`published_data` null); copy sections always (an empty section stays empty); `slug = published_slug`, `draft_data = published_data`, `status = 'published'`, `published_data`, `published_slug`, `published_at = now`, `draft_version = 1`, `content_version = 1`; origin fields from production. Each dev entry gets one milestone revision, note `fork`.
6. `schema_baseline` = production schema snapshot. `last_forked_at = now`.
7. `environment_push` row (`kind = 'fork'`) and audit `dev_env.fork` with counts.

Return the dev site id, slug, and the plaintext site token, schema token and preview secret (shown once, as on site creation).

### Reset from production (refresh)

Input: dev env id. Caller: agency admin (no step-up). In one transaction, under the production advisory lock: delete dev entry revisions, entries and collections (no archive), rerun fork steps 4 to 6 into the same dev site row (tokens, name, preview URL stay), `environment_push` (`kind = 'refresh'`), audit `dev_env.refresh`. The UI shows the unpushed change count from the plan in the confirm dialog, but the server does not require it.

### Delete dev env

Caller: agency admin (no step-up). Delete entry revisions, entries, collections, MCP keys and connections bound to the dev site, then the site row. No archive. Audit `dev_env.delete` (on the production site). `deleteSite` on a production site first deletes its dev env with the same routine, in the same transaction.

### Live pull (snapshot)

`routes/api/sites/snapshot/current.ts`: when the token's site is a dev env, build the snapshot in memory from the dev env's current ready content, with the same builder the publication flow uses to freeze a snapshot, and return it in the same response shape (`publicationId: null`). A `publicationId` query returns 400. Nothing is stored.

### Guards on a dev env

- `updateSite` refuses `publishingMode: 'production'` and any deployment target on a dev env: "Development environments stay in Demo mode." It allows `productionUrl` (the preview URL).
- `requestPublication` and rollback refuse on a dev env.
- `scheduleEntry` refuses on a dev env.
- `changeSiteSlug` on a production site renames the dev slug to `<new>-dev` when free; otherwise refused with a message. On a dev env, slug change is refused. The rename runs under the organization lock, the production row lock and the dev-env advisory lock, and reads the dev env inside the transaction, so a concurrent fork cannot leave the dev env on the old slug. The production `site.update` row does not carry the dev slug. The dev rename is its own `dev_env.rename` row (agency-only).
- Rotating tokens works per site, independently.
- Creating a site whose slug equals a dev slug is refused by the unique check, with a message that the slug belongs to a development environment.
- Archive or delete of a **forked** dev entry sets the dev row to `archived` (so the origin link stays and the push can archive production). Deleting a dev-created entry is a plain delete.

### Schema snapshot

`schemaSnapshot(tx, siteId)` returns collections and sections (enabled and disabled) with all copied columns, plus the languages. It is used for `schema_baseline`, for the plan, and for "schema matches" checks in copy. Collections are compared by `key` and `kind`; fields by `key`.

### Plan (diff) computation

Computed on the server every time. Three-way:

| Item | Base | Dev | Production |
|---|---|---|---|
| Schema item (collection or section, with fields) | `schema_baseline` | dev schema now | production schema now |
| Languages | `schema_baseline.languages` | dev `languages` | production `languages` |
| Entry or section | `origin_baseline` | dev row now | production `content_version` vs `origin_content_version` |

- **Dev changed** = dev differs from base. **Production changed** = production differs from base (entries: `content_version` differs, or the row is gone).
- **Conflict** = both changed. Goes to Needs attention, default Skip.
- Item kinds: `schema.add`, `schema.change`, `schema.remove`, `languages`, `entry.new`, `entry.change`, `entry.archive`.
- A production collection or section that is **disabled** counts as absent when dev has no such collection (and the baseline has none either). A removal that was pushed therefore does not come back as a schema item, and does not count as a production change.
- `schema.remove` and any `schema.change` that drops fields with content are destructive. Their items carry `affectedEntries`: the production entries they change (all entries of a removed collection or section; the entries holding a value of a dropped field), each with the `content_version` the plan saw.
- An entry that holds a production value for a field a pending schema change removes (the field is in production, not in dev) carries `dependsOn: ['schema:<key>']` and `summary.preservedFields` (the kept field keys). Kept fields are not a change of their own: an entry whose only difference from its baseline is a kept field is not listed, and only the removal stays listed. An entry with another change lists its other fields. The UI says "keeps 'excerpt' in production until the removal is applied".
- A destructive schema item that would touch a **scheduled** production entry is `attention: 'scheduled'` (cannot be applied), with the entry titles in `summary.scheduledTitles`.
- **Sections made again in dev.** A dev section with no link that matches a production section by key is `attention: 'conflict'` (Skip by default; Apply overwrites), because production holds a value dev never saw. Any production target of an entry item (entry or section) with a schedule is `attention: 'scheduled'`, however the item was matched.
- **URLs.** An entry item (new, or changed) writes its main slug and each `$i18n.<locale>.$slug`. A URL is taken when another production entry of the same collection (other than the item's own target) holds it: its main slug, or for a localized URL, its slug in the same language. The same rule applies between entries of one push. Taken URLs are listed in `summary.slugCollisions` (`{ locale?, slug, collidesWith }`, where `collidesWith` is the other entry's title) and the item is `attention: 'slug-taken'`. The rule mirrors `validateLocaleSlugs`. Main slugs are not compared with other entries' localized slugs.
- **Languages item.** Its title is a fixed label: the item carries `titleCode: 'site-languages'` for the UI to translate. `title` stays English for MCP.
- `entry.change` lists the changed field keys (and whether the ready version, the draft or both changed) for the one-line summary.
- `planHash`: SHA-256 of the sorted item ids, kinds, base values, production versions, `dependsOn` and `affectedEntries` (ids and `content_version`). Apply requires it; a mismatch is refused with "The plan changed. Review it again."
- The Needs attention flag and its reason are part of each item (`attention: null | 'conflict' | 'drops-content' | 'main-language' | 'scheduled' | 'deleted-in-production' | 'slug-taken'`). The codes live in `apps/cms/src/lib/dev-env.ts` (`PLAN_ATTENTION_CODES`).
- `scheduled` and `slug-taken` items are never applied: `selectPlanItems` skips them even when they are listed in `apply`.
- **Production changes** (`productionChangeCount`, the "Production changed since the last sync" notice): schema and language changes against the baseline, linked entries that moved or are gone, and production entries that a fork would copy (ready and not archived, or any section) that no dev entry is linked to. Collections dev does not have are left to the schema count.

### Push

Input: `planHash`, unticked item ids (`exclude`), `apply` (ids of Needs attention items set to Apply), `goLive`. Caller: agency admin with fresh step-up (`requireFreshAgencyAdmin`).

In one transaction:

1. Lock order: organization, dev site row, production site row (`FOR UPDATE`), then the production advisory lock.
2. Recompute the plan; compare `planHash`.
3. **Validate the resulting schema once.** The production definitions after the selected schema items (untouched ones as they are, applied adds and changes as dev defines them, applied removals disabled) are checked together, with the kind check and `validateContentDefinitions`, before any write. Writes then skip per-item validation, so the order of the items does not matter: a new collection may reference a new collection that sorts after it.
4. **Lock and verify affected rows.** Lock (`FOR UPDATE`, in id order) every production entry that a selected entry item writes, and every entry a selected destructive schema item affects (`affectedEntries`). Each `content_version` must equal the one the plan saw, or the push is refused with "The plan changed". A row these writes touch that is **scheduled** refuses the push ("Scheduled in production. Resolve the schedule first."), whatever the plan showed. Then the **URLs** of the selected entries are checked against the locked production rows (the same rule as the plan, against production and against the other selected entries). A taken URL refuses the push with the message of Copy to production. The plan hash already covers these, so the check is a backstop: it cannot disagree with the plan. This happens before any schema or language write.
5. **Schema**, item by item, with the same logic as `upsertCollection` / `upsertGlobal`. Never `syncManifest` (it is a full sync). Drops are passed as confirmed only for Applied items; dropped values are purged by the existing purge path, which archives.
   - A **removed collection or section is disabled, not deleted**: `enabled = false`, and every production entry of it is set to `archived` with `content_version` bumped. Rows are kept. Normal CMS delete (`deleteCollection`, `deleteGlobal`) is unchanged.
6. **Languages** with `applySiteLanguages` (stamps on main change). The stamp bumps the versions of the entries it touches. Those rows are locked and verified in step 4, so the push re-reads their versions here: the expected version is the locked one plus the transaction's own bumps.
7. **Entries pass 1**: insert new production entries (draft, no data), record `dev id → production id`.
8. **Entries pass 2**: for each selected entry: check `content_version` against the version read in steps 4 and 6, write a revision of the current production draft (note `before dev push`), then write the mirrored state (Decision 13) with references mapped, bump `content_version` and `draft_version`.
   - **Kept fields.** When an entry item depends on a schema removal that is not applied in this push (`dependsOn`), production keeps its own value for each `summary.preservedFields` key, in the draft and in the ready version. The rest of the entry is pushed as usual. Nothing is purged until the removal is applied.
9. **Archives**: set `status = 'archived'` on production entries of selected `entry.archive` items.
10. **Baselines**: for every pushed item, reset the dev row's origin fields from what production now holds; set `origin_entry_id` on dev-created entries; `schema_baseline` = production schema; `last_pushed_at`. For an entry with kept fields, the baseline for those fields is not advanced (the entry's draft and ready keep the old baseline value), so the entry stays listed, with its `preservedFields`, until the removal is applied. The schema baseline keeps a skipped removal listed.
    - **Applied removal, entries not written.** Dev entries of a collection whose field removal is applied, and that this push did not write, take the removal in their baseline: the removed keys drop out of the origin data, and the recorded `origin_content_version` moves with the purge (only if the entry was in step with production before it). Otherwise they would be listed again after the removal.
11. `environment_push` (`kind = 'push'`) and audit `dev_env.push` with counts.

After commit: if `goLive` and the caller may go live, call `requestPublication` for the production site and return its result.

### Reference mapping

Reference fields store the target entry id (also inside `$i18n.<locale>` slots). A dev id with an origin maps to the origin id; a dev-created entry maps to its pass-1 production id; anything else is cleared and listed as a warning. Asset ids are org-wide and need no mapping.

### Copy to production (one item)

Input: dev entry or section id, `markReady` (default false), `overwrite` (default false). Caller: agency admin with fresh step-up. Under the production advisory lock: refuse on schema mismatch for that collection; target = origin entry, else the production entry with the same collection and slug (refuse if another dev entry already links to it); create a new production draft for a dev-created entry with no target; refuse a conflict unless `overwrite`; refuse a **taken URL**: the copied main slug or a localized slug that another production entry of the collection holds, other than the target ("The Dutch URL 'contact' is already used by 'Contact' in production."). `overwrite` does not change this. Write the draft. With `markReady`, the **copied draft** becomes the production ready version (status published, `publishedSlug` = the slug), if the strict check a push uses passes on the mapped draft; if it fails, the draft is still copied and a `ready-not-copied` warning says why, and the production ready version is kept. Then map references (the copied entry itself maps to the production entry it is written to, whether created or matched, so a self-reference holds), update the baseline, log `environment_push` (`kind = 'copy'`) and audit `dev_env.copy_entry`. Ready is not live: a release is still needed.

### Bulk entry action (normal sites, PR 3)

`bulkEntryActionFn({ siteId, action: 'ready' | 'draft' | 'archive' | 'delete', ids })` runs the existing single-entry function per id (same permissions), and returns `{ id, ok, error? }[]`. Not all-or-nothing.

### Locking and concurrency

- Push, reset, copy and fork take `pg_advisory_xact_lock(hashtextextended('dev-env:' || productionSiteId, 3))`.
- A production draft save during a push is caught by the row lock plus the `content_version` check.
- A push only writes drafts, ready flags and archives, so a running publication keeps its frozen snapshot. Go live after push runs after the commit; existing coalescing applies.

## UI

- **Production site, Settings › Development** (agency only, shown per Decision 5): status (exists or not, slug, last reset, last push), **Create development environment**, **Open**, **Reset from production**, **Delete development environment**, the one-time token display after create, and the push history list (date, who, kind, counts).
- **Site switcher** (agency only): dev envs are nested under their production site, with a "Dev" tag.
- **Dev env shell**: a banner "Development environment for <production name>. Changes stay here until you push." with **Push to production**, and a "Production changed since the last sync (N)" notice with **Reset from production** when N > 0. Go live tray, pill and panel are hidden. Schedule actions are hidden.
- **Dev env Settings**: General shows **Preview URL** (default `http://localhost:3000`), no publishing mode or deployment controls. No Development tab on a dev env.
- **Dev entry and section editor**: **Copy to production as draft** in the top bar menu.

### Push screen

A full page at `/sites/<devSiteId>/push`.

```
Push to production · Acme
Development → Production                        [Cancel]  [Push 12 changes · 2 skipped]

Needs attention (3)
  "About" (Pages) — changed in production since the fork      ( Skip | Apply )
  Remove field "Old hero" from Pages — archives 4 values      ( Skip | Apply )
  "Spring offer" (Offers) — scheduled in production           ( Skip )  resolve first

Schema (1)
  [x] Add collection "Case studies"

New entries (3)
  [x] "Spring menu" (Menus)
Changed (7)
  [x] "Home" (Pages)                            3 fields changed · ready + draft
Archived (1)
  [x] "Old offer" (Offers)                      archives production entry

[ ] Go live after push            needs go-live permission
```

- Groups collapse. Rows show a one-line summary. Mobile (390 px) stacks the switch under the label.
- A schema row's title names what it does: `Remove field 'excerpt' · Posts`, `Remove collection · Posts`, `Add collection · Case studies`, `Change collection · Posts`. An entry row's title is `Title · Collection`.
- A row can show detail lines beneath its summary, one line each: `Keeps 'excerpt' in production until the field removal is applied` (entry rows with kept fields) and `Archives 4 values in 2 entries` or `Archives 3 entries` (destructive schema items). A schema item blocked by a schedule gives its reason once, naming the titles: `Scheduled in production: Spring menu. Resolve it first.` A slug-taken reason names the language and URL: `The Dutch URL "contact" is already used by "Contact". Change it in development first.`
- A Needs-attention row whose Apply is not allowed (`scheduled`, `slug-taken`, see `applyAllowed`) shows Apply disabled and Skip selected. The server refuses to apply them too (`selectPlanItems`).
- The push result lists only the non-zero counts (Skipped too, when it is above zero), and says "Nothing was pushed." when all are zero. The Development tab's push history uses the same rule and says "No changes" when nothing changed.
- Decisions are bound to the plan they were made on. A refreshed plan (**Review again**, or a refused push) keeps a decision only while its item is unchanged: the item's id, kind, production `content_version`, attention and summary. A changed or new item loses its decision and is highlighted, with the note "The plan changed. Review the highlighted items again." A decision on a row clears its highlight. The plan query never refetches in the background (no focus or interval refetch).
- No confirm dialogs. Push asks only for the step-up when needed.
- The result view lists counts, warnings (skipped ready, cleared references) and links to the production entries. A written section links to its globals page (`/sites/$siteId/globals/$globalKey`); a written entry links to the entry in its collection. The push result carries each written row's `collectionKind` (`collection` or `global`) for that.
- Push, copy and reset refresh both sites' content, release and publishing queries, the dev env status, the push plan and `me`. The reset confirm fetches the unpushed count again when it opens, and says so while it loads. A dev entry save, a bulk action, a schema or language edit on a dev site refresh its sync status.
- Translated text: the title "Site languages" (`titleCode`), every attention code, every warning code (with its params), and the detail lines. MCP and logs keep the English `message`.

### Entry list (normal sites)

The existing bulk bar (`features/collection/collection-screen.tsx`) calls `bulkEntryActionFn` and gains **Archive (N)**. Failures are listed per entry; successes apply.

### Activity

Sentences in `apps/cms/src/features/activity/activity-sentence.ts` for `dev_env.fork`, `dev_env.refresh`, `dev_env.rename` (with the new dev slug), `dev_env.push` (with counts), `dev_env.copy_entry`, `dev_env.delete`.

## Warnings and codes

Push and copy warnings, and plan attention reasons, are stable codes shared by server and UI (`apps/cms/src/lib/dev-env.ts`). The UI translates them (en, nl, tr); MCP gets the English `message`.

| Code | Where | Params | Meaning |
|---|---|---|---|
| `section-entry-missing` | push | `slug` | A section's entry is not in production, so it was not pushed. |
| `collection-missing` | push | `collectionKey` | The collection is not in production; push the schema first. |
| `reference-cleared` | push, copy | `field`, `locale?`, `devTargetId` | A reference pointed at an entry production does not have; it was cleared. |
| `ready-not-pushed` | push | `details` | Strict validation failed; production keeps its previous ready version. |
| `ready-not-copied` | copy | `details` | Strict validation of the copied draft failed (markReady); the draft is copied, the ready version is not. |

Plan attention codes: `conflict`, `drops-content`, `main-language`, `scheduled`, `deleted-in-production`, `slug-taken`. Plan title codes: `site-languages`. The push screen translates each code, with its params, in `apps/cms/src/features/dev-env/plan-text.ts`. The `details` of a ready warning is the English validation text from the server.

## MCP tools

All new tools are agency-admin only: not listed for others, NotFound on a direct call.

| Tool | Connector | Inputs | Result |
|---|---|---|---|
| `create_dev_environment` | production | `confirm: true` | `devSlug`, `devConnectorUrl`, counts. Tokens are not returned over MCP. They are shown once, in the browser that created the environment; a missed one is replaced by rotating the site token (and the schema token for code-first sites) in Settings › Developer on the development site. |
| `refresh_from_production` | dev | `confirm: true` | counts, number of discarded changes |
| `push_to_production` | dev | `dryRun` (default `true`), `planHash?`, `exclude?`, `apply?`, `goLive?` | Dry run: items, Needs attention list, `planHash`. Apply: counts, warnings, production ids. |
| `copy_entry_to_production` | dev | `id`, `markReady?` (the copied draft becomes the production ready version; not live until a release), `overwrite?` | production id, mapped and cleared references, warnings |
| `mark_ready` | both | `id` or `ids` | per-id results |
| `set_publishing_mode` | dev | any | refused: "Development environments stay in Demo mode." |
| `get_site_info` | both | none | adds `environment`, `productionSlug` (dev), `devEnvironment` (production) |

On dev connectors these tools are not listed: `go_live`, `rollback`, `list_publications`, `cancel_build`, `get_release_status`, `get_build_job`, `schedule_entry`, `cancel_schedule`.

Warnings in results are objects: `{ code, params, message }` (see Warnings below). `message` is English, for MCP and logs; the push screen builds its text from `code` and `params`.

Server instructions and `docs/MCP.md` say that a push is a review step, and that a dry run must be shown to the user before the apply call. The skills drift test (`packages/skills/src/drift.test.ts`) must pass.

## Docs and skills

Update `docs/ADMIN_GUIDE.md`, `docs/MCP.md`, `docs/AUTHZ_MATRIX.md`, `docs/CMS_GUIDE.md`, `apps/docs` (a development environments page with the local token swap steps), `skills/areca-mcp` and `skills/areca-quickstart` (on a live site, connect to the dev env, pull with the dev token, push through the CMS). Do not edit `version` or `CHANGELOG.md` by hand.

## Permissions

| Action | Agency admin | Org owner | Org editor |
|---|---|---|---|
| See / edit the dev env | yes | no | no |
| Create, reset, delete the dev env | yes | no | no |
| Push or copy to production | yes (fresh step-up) | no | no |
| Go live production after push | yes, if allowed | — | — |
| Go live / schedule / set Production on a dev env | never | never | never |
| Bulk actions on normal sites | as the single action | as the single action | as the single action |

Each new server function is added to `apps/cms/src/server/security/authz-matrix.ts` and `docs/AUTHZ_MATRIX.md`. New API behaviour is covered in `authz-routes.test.ts` where routes change.

## Edge cases

1. **Language added in dev.** One item in the push list. Entries lacking a newly required language cannot be ready in production; they land as drafts with a warning.
2. **Main language changed in dev.** Needs attention, with the stamp count.
3. **Collection renamed in dev.** Remove plus add.
4. **Collection deleted in dev.** `schema.remove`; Needs attention if production has content. Apply disables the production collection and archives its entries (rows are kept). Nothing comes back in later plans.
5. **Production entry deleted after the fork, dev changed it.** Needs attention, "Deleted in production"; Apply recreates it as a draft.
6. **Production entry archived after the fork.** A production change (`content_version`); conflict if dev also changed it. Apply restores it from dev.
7. **Production entry scheduled.** Needs attention, cannot be applied until resolved.
8. **Slug collisions.** `-dev-2` and so on; rename follows the production slug or is refused.
9. **Code-first sites.** The next `areca manifest push` to production is a full sync and can undo a UI push. Update `areca.config.ts` (`areca manifest pull` with the dev token) before pushing the manifest to production.
10. **Asset delete.** Already checks usage across the organization; no change.
11. **Client member guesses a dev id or slug.** NotFound everywhere.
12. **Dev entry with a draft but no ready version.** Pushed as a production draft only.

## Testing plan

- **Unit** (no database): plan rules, item kinds, Needs attention flags, reference mapping, slug candidates, `planHash`.
- **DB tests** (`*.db.test.ts`): fork copies schema and ready content only; reset replaces everything; delete removes dev rows; `content_version` bumps on every write path; push schema-first, Apply/Skip, archive instead of delete, mirrored ready/draft, reference mapping, baseline update, stale `planHash`; conflicts (skip, apply, deleted in production, scheduled); copy (schema mismatch, overwrite, new draft); concurrency (two pushes, a production save during push); visibility (client member gets NotFound on every site-scoped function, `me.ts` hides dev); guards (mode, deployment, schedule, publication, check constraint); live pull snapshot shape and pinned 400; bulk action per-id results.
- **MCP tests**: tool lists for admin vs others and dev vs production; dry run writes nothing; refusals; drift test.
- **Playwright**: create dev env; edit a field and an entry in dev; push with one conflict skipped and one applied; go live after push queues a build; bulk archive on a normal site; client user does not see the dev env. Push screen at 390 px.
- Screenshots of the push screen and the Development tab before the UI PRs.

## Rollout

Four stacked PRs. PR 1 is `feat/developer-environment`; later branches stack on it.

1. **`feat/developer-environment`** — this doc, migration 0036, `content_version` bumps, visibility helper and all visibility filters, fork / reset / delete, live pull, dev guards (mode, deployment, schedule, publication, slug), dev preview URL, Settings › Development tab, switcher nesting, dev banner, hidden Go live, audit sentences, DB and authz tests.
2. **`feat/developer-environment-2-push`** — plan, push, Needs attention, reference mapping, baselines, go live after push, push screen, push history list, "production changed" notice, tests.
3. **`feat/developer-environment-3-copy-bulk`** — copy to production, its editor action, bulk entry action and the bulk bar Archive, tests.
4. **`feat/developer-environment-4-mcp-docs`** — MCP tools and hiding, `get_site_info` fields, server instructions, docs, skills, drift test.
