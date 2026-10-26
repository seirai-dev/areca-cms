# Development environments

Status: agreed with the product owner on 26 Oct 2026. Not built yet. This is the contract the later PRs implement. Delivered as four stacked PRs (see Rollout).

## Problem and workflow

Today every edit goes straight to the production site. When a customer asks for a change, the agency edits the live site's schema and content, and there is no safe place to try it first. The agency also wants to show the customer a demo release before anything is published to the production site.

The agency's workflow:

1. A new site is created for a customer. It is a normal site in Demo mode.
2. The agency sets it up with the `areca-quickstart` agent skill and creates test entries.
3. The agency pulls the content locally and checks it.
4. The agency deploys on Dokploy with the production URL and switches the site to Production.
5. The customer asks for a change.
6. The agency forks production into the site's **development environment**.
7. The agency makes schema and/or content changes there, in the CMS UI, the CLI or over MCP.
8. The agency makes a demo release in the development environment, pulls it locally and checks it.
9. The customer approves.
10. The agency **pushes** the changes to production. Optionally the agency also goes live, which starts the production build.

The agency edits the CMS about 90% of the time. Customers email change requests.

## Vocabulary

- **Production site**: a site with `environment = 'production'`. This is every site that exists today.
- **Development environment** (dev env): a linked site with `environment = 'development'`. It belongs to exactly one production site, through `parent_site_id`. It is shown to agency admins as "Development".
- **Fork**: creating the dev env by copying production's schema and ready content.
- **Refresh**: replacing everything in the dev env with a new fork of production.
- **Push**: copying chosen dev changes into production (schema, entries, sections, archives).
- **Copy to production**: pushing one entry or section, as a draft.
- **Baseline**: the state of an item when it was last forked or pushed. Used to tell what changed in dev and what changed in production.
- **Origin**: the production entry a dev entry was forked from.
- **Demo release**: a publication in Demo mode. It is only pulled by `areca pull`. Visitors never see it.

Other vocabulary follows `docs/DECISIONS.md` and `docs/ARCHITECTURE.md`.

## Decisions

These are settled. They are recorded here, not reopened.

1. **Shape: a linked site.** A dev env is a real `site` row, marked as a development site, linked to its production site. It reuses all per-site machinery: its own site read token, its own schema token, its own MCP connector at `/api/mcp/<slug>-dev`, and its own publications. It is not an `environment` column added to every table.
2. **New client sites are normal sites.** A brand-new client site is a normal site in Demo mode. "Promote" for a new site means setting the deployment target and switching to Production. Dev envs only exist next to a production site. New sites are not hidden from client users. The agency chooses when to invite them.
3. **Visibility: agency admins only.** Client owners and editors never see a dev env: not in the site list, the site switcher, notifications, MCP access or any guard. Membership is per organization today, so each check must test the dev flag explicitly.
4. **Exactly one dev env per production site, permanently.** All developers share it. There are never several. It has a Delete action. Deleting the production site deletes its dev env too. The slug is `<slug>-dev`. Slugs are globally unique, so collisions are handled (see Edge cases).
5. **Always Demo mode.** A dev env can never switch to Production. The `set_publishing_mode` MCP tool and the UI both refuse Production on a dev site. Its releases only feed `areca pull`.
6. **Fork and refresh copy content.** A fork copies the production schema (collections, sections, languages, route patterns, required languages). It also copies every production entry's ready version (`published_data`) as ready in the dev env, so a demo release and a pull work at once. Unfinished production drafts are not copied. Refresh replaces the dev env completely. It warns when the dev env has unpushed changes. Assets are organization-scoped, so the media library is shared and nothing is duplicated. Images uploaded in dev go into the shared library.
7. **Origin and baseline.** Each forked entry records its production entry id (origin) and the production version at fork time (baseline). Entries created in dev have no origin. They become new production entries on push. References between entries are mapped through origin ids.
8. **Push screen.** One list of everything changed in dev since the fork or the last push, all ticked by default. Each item can be unticked. The list covers:
   - schema changes: added, changed or removed fields, collections, sections and languages. Removals that drop content need explicit confirmation, like `confirmDropFields`;
   - new entries;
   - changed entries and sections;
   - entries deleted or archived in dev. These **archive** the production entry. A push never hard-deletes production content.

   Two options: **Mark pushed changes ready** (on by default, the bulk ready) and **Go live after push** (off by default, needs the go-live permission, starts the production build). Without go live, nothing reaches visitors. The normal mark ready and go live flow in production still applies.
9. **Conflicts.** If a production entry changed since the baseline (for example a client editor edited it), the push screen flags it. Each conflicting item has a choice: **keep production** (the default, the item is skipped) or **overwrite with dev**. After a push, the baseline is updated, so the next push only shows new changes.
10. **Copy to production as draft.** A "Copy to production as draft" button in the dev entry editor (and for sections) and an MCP tool copy one item. The copy becomes the new **draft** of the matching production entry. The live version stays as it is. The copy is blocked if the production schema for that collection does not match the dev schema ("Push the schema first"). All languages are copied. References are mapped. References that cannot be mapped are cleared, and the copy lists them as warnings.
11. **Bulk mark ready and bulk archive on normal sites.** Multi-select in the collection list. The MCP `mark_ready` tool accepts several ids. This is part of the first build.
12. **MCP.** Refresh, push and copy-to-production act on the dev connector, on its linked production site, for agency admins only. Creating the dev env is on the production connector, because no dev connector exists yet. `get_site_info` on a dev site reports `environment: 'development'` and the production site's slug.
13. **Local project.** `.env.local` points at the dev env's site token, so `content:sync` and `content:pull` pull the dev env. Deployed builds use the production token from the deployment's environment variables. To check production locally, swap `ARECA_SITE_TOKEN` (and `ARECA_SCHEMA_TOKEN` for code-first sites) for the production values. Code-first sites: run `areca manifest push` to the dev token, test, then push the schema to production with the UI Push or with the production schema token. `siteKey` in `areca.config.ts` is informational. The CMS uses the token's site. Checked: no `siteKey` comparison exists in `apps/cms/src/routes/api/sites/manifest.ts` or `apps/cms/src/server/content/collections.ts`. The `areca-quickstart` skill, when run on a live site, connects to the dev env.
14. **Audit.** Fork, refresh, push (with item counts), copy and delete are all written to the audit log.

## Non-goals

- Several dev envs per production site.
- Content promotion without review. Push always shows a list the agency reviews.
- Dev envs for demo-only sites. A dev env needs a production site.
- Client-user access to dev envs in v1. Customers only see the production site.
- A visual diff of entry content. The push list shows which fields changed. A field-level preview comes later.
- Renaming collections as a special case. A rename is a remove plus an add.

## Data model

Migration `0036_dev_environments` (next after `0035_account_management_blocking`).

### `site`

| Column | Type | Notes |
|---|---|---|
| `environment` | `text not null default 'production'` | `'production' \| 'development'` |
| `parent_site_id` | `text null` → `site.id` on delete cascade | Set only on dev envs. Unique (one dev env per production site). |
| `schema_baseline` | `jsonb null` | Dev envs only. The production schema (`SiteManifest` shape) at the last fork or push. |

Check constraints (backstops; the app checks the same rules first):

- `environment = 'production' or (parent_site_id is not null and publishing_mode = 'demo')`
- `environment = 'development' or parent_site_id is null`

The existing `publishing_mode` column (`apps/cms/src/db/schema.ts`, `site` table) defaults to `'production'`. Dev envs are stored as `'demo'`.

### `entry`

| Column | Type | Notes |
|---|---|---|
| `origin_entry_id` | `text null` | Production entry id. **No foreign key, on purpose.** If a production entry is hard-deleted, the dev link must survive. Otherwise the next push would treat it as new and create a duplicate. |
| `origin_baseline` | `jsonb null` | `{ slug, data }`: the content at the last fork or push. Used to see what changed in dev. |
| `origin_draft_version` | `integer null` | Production `entry.draft_version` at the last fork or push. |
| `origin_published_at` | `timestamptz null` | Production `entry.published_at` at the last fork or push. |

Entries that exist in production have no origin fields set on the production side. The origin fields are only read on dev envs.

### `environment_push` (log)

| Column | Type | Notes |
|---|---|---|
| `id` | `text` | Same id helper as other tables. |
| `dev_site_id` | `text` → `site.id` on delete cascade | |
| `production_site_id` | `text null` → `site.id` on delete set null | Kept as a record after the production site is gone. |
| `kind` | `text` | `fork`, `refresh`, `push`, `copy` |
| `actor_id` | `text null` → `user.id` on delete set null | |
| `counts` | `jsonb` | For example `{ schema: 2, new: 3, changed: 5, archived: 1, conflictsSkipped: 1 }` |
| `items` | `jsonb` | Item ids, kinds, the choice made for each conflict, and the production id each item wrote to. Used by the history list. |
| `created_at` | `timestamptz` | |

### Migration notes

- All new columns are nullable or have a default. Existing rows need no backfill: every site is a production site.
- The unique index on `parent_site_id` is partial, `where parent_site_id is not null`, so ordinary production sites do not conflict.
- The `entry` columns are only written on dev envs. Production rows are not touched.

## Server

### Fork (create dev env)

Input: a production site id. Caller: agency admin with a fresh step-up (`requireFreshAgencyAdmin`, `src/lib/session.server.ts` l.79).

Refused when the site is not a production site, or when it already has a dev env.

In one transaction (the same pattern as `createSite` and `deleteSite` in `apps/cms/src/server/admin/sites.ts`, which take `lockOrganizationForMutation` first):

1. Lock the production site row (`FOR UPDATE`).
2. Choose the slug: `<slug>-dev`. If it is taken, try `<slug>-dev-2`, and so on.
3. Insert the dev site row:
   - `name` = `<production name> (dev)`
   - `environment` = `'development'`, `parent_site_id` = production id
   - `publishing_mode` = `'demo'`, `deployment_target` = null
   - `production_url` = copied from production (not used for deploys; see Open questions)
   - new read token, schema token and preview secret, made with the same helpers `createSite` uses
   - `languages` copied from production
4. Copy collections (including disabled ones, with their `enabled` flag) with all their columns: `key`, `label`, `route_pattern`, `fields`, `kind`, `seo_enabled`, `preview_path`, `required_languages`, `localized_routes`. The unique key `(site_id, key)` applies per site, so the same keys are fine.
5. Copy entries. For each production entry of a collection or section:
   - skip `archived` entries;
   - skip collection entries that were never ready (`published_data` is null);
   - a section never marked ready is still copied, as an empty section, the same as production;
   - copy `slug = published_slug`, `draft_data = published_data`, `status = 'published'`, `published_data`, `published_slug`, `draft_version = 1`;
   - set `origin_entry_id` = production id, `origin_baseline = { slug, data }` (the ready version), `origin_draft_version` and `origin_published_at` from production;
   - scheduled versions and production drafts are not copied;
   - revisions are not copied. Each dev entry gets one milestone revision, note `fork`.
6. Set `schema_baseline` to the production schema.
7. Write the `environment_push` row (`kind = 'fork'`) and the audit row `dev_env.fork` with the counts.

Assets are not copied. They are organization-scoped (`asset.organization_id`), so the dev env sees the same library.

### Refresh

Input: the dev env id. Caller: agency admin with fresh step-up.

1. Compute the push plan (below). If there are unpushed changes, the request needs `confirmDiscard: <count>`. The count must match the plan, so the warning cannot be skipped by accident.
2. Refused while a dev build job is queued or running.
3. In one transaction:
   - archive the dev env's content to `deleted_content_archive` (entries, collections, the site), so the work is recoverable;
   - delete the dev entries, their revisions and the dev collections;
   - run the fork steps 4 to 6 again. The dev site row, its tokens and its name stay the same.
4. Write `environment_push` (`kind = 'refresh'`) and audit `dev_env.refresh`.

### Plan (diff) computation

The push plan is computed on the server every time. The client never sends its own diff. It is a three-way comparison:

| Item | Base (baseline) | Dev (changed by the agency) | Production (changed by others) |
|---|---|---|---|
| Schema item (a collection, section or field) | `site.schema_baseline` | dev schema now | production schema now |
| Entry or section | `origin_baseline` | dev `draft_data` and `slug` | production `draft_version` and `published_at` against the origin fields |

Rules:

- **Dev changed** = dev differs from base.
- **Production changed** = production's `draft_version` or `published_at` differs from the origin fields (schema: production differs from base).
- **Conflict** = dev changed and production changed.
- A conflict is unticked by default. Its choice is "keep production" (default) or "overwrite with dev".

Item kinds:

- `schema.add`, `schema.change`, `schema.remove` (collections and sections, with their fields)
- `languages` (the site setting, using the same rules as the UI: removing a language hides it, changing the main language stamps data)
- `entry.new`, `entry.change`, `entry.archive`

A production entry with a scheduled version (`scheduled_at` set) is not pushed. It shows as a conflict ("Scheduled in production. Resolve it first.").

The plan returns a `planHash` (a hash of the item ids, kinds and base values). Apply requires that hash. If the plan changed since the screen was loaded, apply is refused with "The plan changed. Review it again."

Tell whether `draft_version` bumps on every draft save before relying on it. Check `apps/cms/src/server/content/entry-workflow.ts`. If it does not bump on every change, add an explicit production version counter in the same migration.

### Push

Input: `planHash`, the selected item ids, the conflict choices, `markReady`, `goLive`, and `confirmDropFields` for schema removals. Caller: agency admin with fresh step-up.

Steps, in one transaction:

1. Lock order: organization (`lockOrganizationForMutation`), then the dev site row, then the production site row (`FOR UPDATE`). Take a transaction advisory lock on the production site id, the same way the publication request lock does (`src/server/publishing/publications.ts` l.75). Only one push, refresh or copy runs per production site at a time.
2. Recompute the plan and compare the `planHash`.
3. **Schema first.** Apply each selected schema item with the same logic as `upsertCollection` and `deleteCollection` (`src/server/content/collections.ts` l.253 and l.374), one item at a time.
   - Do not call `syncManifest` (l.66) for a partial push. It is a full sync: any collection missing from the payload is disabled.
   - Removals with content need the item in `confirmDropFields`. Removed content is archived, never hard-deleted.
4. **Languages.** Apply the selected language change with the content-languages rules.
5. **Entries, pass 1.** For each new dev entry, insert the production entry with the mapped slug and no data yet. Record `dev id → production id`.
6. **Entries, pass 2.** For each selected changed or new entry:
   - lock the production row (`FOR UPDATE`) and check `draft_version` against the plan;
   - write a revision of the current production draft (note `before dev push`), so an overwritten draft can be restored;
   - write the dev draft as the production draft: `draft_data` with references mapped, `slug`, `draft_version + 1`;
   - if `markReady` is on, run the strict validation that `publishEntry` runs. If it fails, the draft is still written, but ready is skipped and the item is listed as a warning.
7. **Archives.** Archive the production entries of selected `entry.archive` items (`status = 'archived'`).
8. **Baselines.** For every pushed item, set the dev row's `origin_baseline`, `origin_draft_version` and `origin_published_at` from what production now holds. Set `origin_entry_id` on pushed dev-created entries. Set `schema_baseline` to the production schema.
9. Write `environment_push` (`kind = 'push'`, counts, items) and audit `dev_env.push` with the counts.

After the transaction commits:

10. If `goLive` is on and the caller may go live, call `requestPublication` for the production site. That function already validates the content and coalesces queued builds.

### Reference mapping

References store the target entry id as a string (`src/server/content/validation.ts` l.121). Mapping:

- a dev id with an origin maps to the origin id;
- a dev-created entry maps to the production id created in pass 1;
- anything else cannot be mapped. The reference is cleared and listed as a warning.

Production entries never reference dev-only ids, so no mapping is needed in that direction.

### Copy to production (one item)

Input: the dev entry or section id, `markReady` (default false). Caller: agency admin.

1. Refused when the production collection schema does not match the dev schema for that collection: "Push the schema first."
2. Find the target: the origin entry if there is one; otherwise the production entry in the same collection with the same slug. If another dev entry is already linked to that production entry, refuse.
3. If no target exists and the dev entry was created in dev, create a new production draft entry. If the slug is taken by an unrelated production entry, refuse.
4. Apply the same conflict rule as push (default: refuse unless the caller confirms an overwrite).
5. Write the draft (and optionally ready), map references, set the baseline, and log `dev_env.copy_entry`.

### Archive semantics

- Archiving in production sets `status = 'archived'`. The entry leaves the next snapshot. Nothing is deleted.
- Archiving or deleting a forked entry in dev does not hard-delete it. It sets the dev row to `archived`, so the origin link stays and the push can archive production. Deleting a dev-created entry (no origin) is a plain delete.
- Sections are never archived (globals never use `archived`, see `docs/design/site-content-globals.md`). A section removed in dev is a schema removal, handled as above.

### Locking and concurrency

- Push, refresh and copy take the production site advisory lock, and lock rows in a fixed order.
- An editor saving a draft in production during a push is handled by the row lock plus the `draft_version` check. A save that lands first is seen as a conflict. A save that lands after the push is a normal later edit.
- Publishing works from a frozen snapshot. A push only writes drafts and ready flags, so a publication that is already running keeps its own snapshot. The worker's deployment lock is keyed by `deploymentResourceKey` (`src/server/publishing/worker.ts` l.214 to l.218), and a dev env has no deployment, so dev demo releases never wait for a production deploy.
- "Go live after push" runs after the commit. Existing coalescing cancels queued builds for the site.

### Visibility and guards

- **Helper.** Add one helper, `assertSiteVisibleTo(session, site)`. A dev site requires `requireAgencyAdmin`. Any other site keeps today's checks. Every site-scoped function calls it.
- **Why a helper.** `requireOrgMember` (`src/lib/session.server.ts` l.85) checks the organization. Agency admins pass it for every site. A client member passes it for every site of their client, dev envs included. The per-site check is what hides the dev env.
- **Site list.** The client branch of `me.ts` (`apps/cms/src/server/fn/me.ts` around l.123 to l.146) adds `environment = 'production'`. The agency-wide branch keeps dev envs. Agency admins see them in the switcher, nested under their production site.
- **MCP.** `requireMcpSiteAccess` (`apps/cms/src/server/mcp/site-access.ts`) returns NotFound for a dev site when the caller is not an agency admin. This is the same answer a missing site gets. `roleFor` already returns `'agency'` for admins.
- **Connect AI.** The consent screen and the connection list hide dev connectors from non-admins.
- **Notifications.** In v1, no notification events are created for dev envs. Dev activity is audit-only.
- **Tests.** An authz test (see Testing plan) checks every site-scoped function with a client member and a dev site.

### Deleting

- **Delete dev env.** Agency admin, fresh step-up, type-to-confirm with the dev slug. Works like `deleteSite` (`apps/cms/src/server/admin/sites.ts` l.388): archive the content with `archiveDeletedContent`, then delete entries, revisions, collections, builds and publications. The dev env's publications are demo, so they are not blocked by `assertSiteHasNoPendingDeployment`. Audit `dev_env.delete`.
- **Delete production site.** In the same transaction, delete the dev env first, through the same routine, so its content is archived with the production site's. The database cascade on `parent_site_id` is only a backstop. It does not archive anything.

### Tokens and slugs

- Dev tokens are separate. Rotating the dev token does not touch production, and the reverse is also true (`rotateSiteTokenAdmin`, `sites.ts` l.345).
- `changeSiteSlug` (`sites.ts` l.284) also renames the dev slug to `<new>-dev` when that is free. If it is taken, the slug change is refused with a message.
- Creating a site whose slug equals an existing dev slug is refused by the normal unique check. The message says the slug belongs to a development environment.

### Publishing mode guard

- `updateSite` (`sites.ts` l.195, mode patch at l.222) refuses `publishingMode: 'production'` on a dev env, and refuses setting a deployment target on it.
- The `set_publishing_mode` MCP tool uses the same check.
- The check constraint in the database is the last line of defence.

## UI

### Where things live

- **Production site, Settings › Development** (agency only): the dev env's status (exists or not, slug, last fork, last refresh, last push), **Create development environment** (fork), **Refresh from production**, **Delete development environment**, and a link to open the dev env. The tab does not appear for clients.
- **Site switcher** (agency only): dev envs are nested under their production site, with a "Dev" tag. Clients never see them.
- **Dev env header**: a banner "Development environment for <client>. Demo only. Releases feed `areca pull`." The top bar has **Push to production** (agency only). The "Go live" button becomes **Release for pull** (a demo release).
- **Dev entry and section editor**: a **Copy to production as draft** action in the top bar's menu, with a warning when the production schema for that collection does not match.

### Push screen

A full page, not a sheet, because the list can be long.

```
Push to production · Acme
Development → Production              [Cancel]  [Push 12 changes]

Schema (2)                                    1 removal needs confirmation
  [x] Add collection "Case studies"
  [ ] Remove field "Old hero" from Pages      drops 4 values  (confirm)

Languages (0)

New entries (3)
  [x] New: "Spring menu"  (Menus)
  ...

Changed (7)
  [x] "Home" (Pages)                          3 fields changed
  [ ] "About" (Pages)  ⚠ Changed in production since the fork
        ( ) Keep production  (default)   ( ) Overwrite with dev

Archived (1)
  [x] "Old offer" (Offers)                    archives production entry

Options
  [x] Mark pushed changes ready
  [ ] Go live after push                      needs go-live permission

Summary: 12 selected · 1 conflict skipped · 1 removal needs confirmation
```

- Groups collapse. Each row has a checkbox, a one-line change summary and a conflict badge.
- Conflict rows show two radio options. Keep production is selected by default.
- Removals open a confirm dialog that lists the collection or field and how many values will be archived.
- The push button shows the number of selected items. It is disabled while a removal is unconfirmed.

### Entry list (normal sites)

- Checkboxes on each row. A bulk bar appears with **Mark ready (N)** and **Archive (N)**. Owners only, as with the single actions.
- The result lists per-entry failures with reasons. Successes still apply. This is not all-or-nothing.

### Activity

- New sentences in `apps/cms/src/features/activity/activity-sentence.ts` for `dev_env.fork`, `dev_env.refresh`, `dev_env.push` (with counts), `dev_env.copy_entry` and `dev_env.delete`.

## MCP tools

All tools below are for agency admins only. For any other caller they are not listed, and a direct call returns NotFound.

| Tool | Connector | Inputs | Result |
|---|---|---|---|
| `create_dev_environment` | production | `confirm: true` | `devSlug`, `devConnectorUrl`, counts |
| `refresh_from_production` | dev | `confirmDiscard?: number` | counts; error if unpushed changes and no matching `confirmDiscard` |
| `push_to_production` | dev | `dryRun` (default `true`), `planHash?`, `items?`, `decisions?`, `markReady?`, `goLive?`, `confirmDropFields?` | Dry run: the plan (items, conflicts, removals) and `planHash`. Apply: counts, warnings, and the production ids written. Apply needs `planHash`. Removals need `confirmDropFields`. |
| `copy_entry_to_production` | dev | `id`, `markReady?` (default `false`), `overwrite?` | production id, mapped and cleared references |
| `mark_ready` | both | `id` or `ids` (new array form; `id` still works) | per-id results |
| `set_publishing_mode` | dev | any | refused on a dev env: "Development environments stay in Demo mode." |
| `get_site_info` | both | none | adds `environment` and `productionSlug` |

- Dry run is the default, so a model cannot push by accident.
- MCP does not ask for a fresh 2FA code on each call. The key or connection that the agency admin approved already required one (existing rule, see `docs/ARCHITECTURE.md`, "AI apps (MCP)").
- Server instructions and `docs/MCP.md` say that a push is a review step, and that a dry run must be shown to the user before the apply call.
- The drift test in `skills/areca-mcp` must pass when the tools are added.

## SDK and CLI impact

- **No SDK change is needed for v1.** `areca pull` works with the dev token as it does with any token.
- Optional, later: the snapshot response can include `environment`, so `areca pull` prints "Pulling development environment". Not part of v1.
- **Docs only.** Update `docs/ADMIN_GUIDE.md`, `docs/MCP.md`, `docs/AUTHZ_MATRIX.md`, `docs/CMS_GUIDE.md`, `apps/docs` (new page for development environments, plus the local token swap steps), `skills/areca-mcp` and `skills/areca-quickstart`.
- The `areca-quickstart` skill, when it runs on a live site, connects to the dev env. It must not write to production. The skill tells the user to pull with the dev token and to push through the CMS.
- Do not edit `version` or `CHANGELOG.md` by hand (see `docs/design/site-content-globals.md`).

## Permissions

| Action | Agency admin | Org owner | Org editor |
|---|---|---|---|
| See the dev env | yes | no | no |
| Create or refresh the dev env | yes (fresh step-up) | no | no |
| Edit, create, delete content in the dev env | yes | no | no |
| Mark ready in the dev env | yes | no | no |
| Release for pull (demo) in the dev env | yes | no | no |
| Go live a dev env | never | never | never |
| Push or copy to production | yes (fresh step-up) | no | no |
| Go live production after push | yes, if allowed | yes, if allowed | no |
| Set Production on a dev env | never | never | never |
| Delete the dev env | yes (fresh step-up) | no | no |

Each new server function is added to `apps/cms/src/server/security/authz-matrix.ts` and `docs/AUTHZ_MATRIX.md`.

## Edge cases

1. **Languages added in dev.** The language change is one item in the push list. Entries that lack the new language cannot be marked ready in production. They stay drafts, and the push lists them as warnings.
2. **Main language changed in dev.** Pushing applies the same stamp rule as the UI (`$locale` stamping in `content-languages.md`). A confirm is shown with the gap count.
3. **Collection renamed in dev.** A rename is a remove plus an add. The remove needs confirmation if it drops content.
4. **Collection deleted in dev.** Its dev content is archived in dev. On push, the production collection is removed through the UI's delete path, which archives content, after confirmation.
5. **Required languages changed.** Entries that cannot satisfy a new requirement stay drafts (see item 1).
6. **Production entry deleted after the fork, and dev changed it.** The origin link has no foreign key, so it survives. The item is a conflict: "Deleted in production." The default is skip. "Overwrite" recreates the entry as a draft.
7. **Production entry archived after the fork.** Treated the same as a changed production entry. Overwrite can restore it as a draft.
8. **Production entry has a scheduled version.** Not pushed. It is a conflict until the schedule is resolved.
9. **Schema push removes fields that have content.** Requires `confirmDropFields`. The dialog shows how many values will be archived.
10. **Publication in progress during push.** A push does not change a running publication's snapshot. Go live after push is queued after the commit.
11. **Slug collisions.** `<slug>-dev` taken: try `-dev-2`, and so on. A new client slug that matches a dev slug is refused. Changing the production slug renames the dev slug or is refused.
12. **Code-first sites.** The next `areca manifest push` from code is a full sync to production. It overwrites schema changes made by UI push. For code-first sites, update `areca.config.ts` to match before the next manifest push to production.
13. **Asset delete.** The library is shared, so deleting an asset in dev would delete it for production too. Asset delete must refuse an asset that any production entry uses, not only the current site's entries. Check the current delete path before the first PR ships.
14. **Dev demo build during refresh.** Refused until the build finishes or is cancelled.
15. **Dev env deleted while production is in use.** Allowed. Production is not affected. Its audit rows stay.
16. **Client member guesses a dev site id or slug.** Every path returns NotFound, the same as for a missing site.
17. **Unpushed changes at refresh.** The plan's count must be confirmed (`confirmDiscard`).
18. **Dev entry with a draft but no ready version.** Push sends the draft. A dev entry that was never ready has no demo release content until it is marked ready in dev.

## Testing plan

- **Pure unit tests** (no database): the three-way plan rules (dev changed, production changed, conflict), the item kinds, reference mapping (origin, pass 1 ids, cleared references), slug candidate generation, and the `planHash`.
- **DB tests** (`*.db.test.ts`, the same style as `docs/design/account-management.md`):
  - fork copies schema, ready content and not drafts; origin and baseline are set; archived and never-ready entries are skipped;
  - refresh archives dev content first, and refuses without the matching `confirmDiscard`;
  - push: schema-first order, drop confirmation, archive instead of delete, reference mapping, baseline update, stale `planHash` refused;
  - conflicts: keep, overwrite, production deleted after the fork;
  - copy: schema mismatch refused, overwrite confirmation, new draft for dev-created entries;
  - concurrency: two pushes on the same production site (one waits); a production draft save during a push is detected;
  - delete: dev delete archives; production delete removes the dev env with an archive;
  - visibility: a client member gets NotFound for every site-scoped function on a dev site; `me.ts` site list hides dev envs for clients;
  - publishing mode: refused on dev, check constraint holds.
- **MCP tests**: the tools are listed only for agency admins; the dry run applies nothing; a dev connector refuses set_publishing_mode; the drift test passes.
- **Playwright**: create dev env; edit a schema field and an entry in dev; push with one conflict kept and one overwritten; go live after push (asserting the build is queued); bulk mark ready on a normal site; a client user does not see the dev env in the switcher. Mobile viewport (390) for the push screen.
- Screenshots of the push screen and the Development tab are needed before the UI PR is opened (see the screenshot rule in the memory notes).

## Rollout

Four stacked PRs, each reviewed on its own. Branch `feat/dev-environments`, with the later branches stacked on the earlier ones.

1. **Data model, fork, refresh, visibility, delete.** Migration `0036`, the `site` and `entry` columns, the `environment_push` table, the visibility helper and the MCP access check, the `me.ts` filter, the Development tab (create, refresh, delete), the Publishing-mode guard, audit sentences, DB and authz tests.
2. **Push.** Plan computation, the push screen, conflicts and their choices, reference mapping, baselines, the drop confirmation, go live after push, the push history list, the audit counts, and the concurrency tests.
3. **Copy to production, bulk ready and archive.** The single-item copy and its button, bulk mark ready and archive on normal sites with per-id results, and the bulk bar.
4. **MCP tools, docs and skills.** `create_dev_environment`, `refresh_from_production`, `push_to_production`, `copy_entry_to_production`, the `mark_ready` array form, `get_site_info` fields, `set_publishing_mode` refusal, `docs/MCP.md`, `docs/AUTHZ_MATRIX.md`, `apps/docs` (a development environments page and the token swap steps), `skills/areca-mcp` and `skills/areca-quickstart`.

## Open questions

These are small. The default in each case is the one shown, and it can change during review.

1. **Preview on a dev env.** The dev env copies `production_url`, so its preview links open the live site, not the dev env. Default: hide preview on dev envs in v1 until a dev preview base is set.
2. **Name in the UI.** "Development" in tabs and headings, "Dev" as a tag. Default: keep both, as written above.
3. **Dev env for a Demo-mode production site.** Default: allowed. The rule is "the site is a production site (not a dev env)", not "the site is in Production mode".
4. **Notifications for agency admins about dev envs.** Default: none in v1 (audit only).
