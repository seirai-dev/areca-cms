---
name: areca-mcp
description: Connects an AI client to an Areca CMS site through its MCP server and uses its tools to write, edit, review and publish content. Covers the per-site connector URL, OAuth sign-in or personal keys, roles and go-live permission, the draft/ready/live workflow, development environments (review and push), field and Markdown formats, SEO, images, and every tool. Use when the user wants to connect Areca to an AI app or coding agent, or to create, update, approve, schedule or publish Areca CMS entries, upload images, or check what is live.
license: MIT
metadata:
  version: "0.8.0"
---

# Areca MCP

Every Areca site has its own remote MCP server. Through it an AI can read and write that site's content: entries, site content (single sections such as company info), the media Library, releases and, for agency admins, content types and site content structure. Agency admins can also use one agency-wide connector for every client and site (see [Agency connector](#agency-connector-agency-admins)). It edits CMS content and is separate from the `@areca-cms/site-sdk` website code (see the `areca-sdk` skill).

## Connect

- **Connector URL:** `https://<cms-host>/api/mcp/<site-slug>`. The user copies it from the site's **Connect AI** page in the CMS. Don't guess it: if `ARECA_CMS_URL` and the `siteKey` in `areca.config.ts` exist, it is `${ARECA_CMS_URL}/api/mcp/${siteKey}`. Confirm that with the user.
- **Transport:** Streamable HTTP (stateless, JSON responses). Suggested server name: `areca-<site-slug>`.
- **Auth:** OAuth 2.1 in the browser. Add only the URL, and the client opens a sign-in and consent page on first use. No secret goes in config.
- Claude Code: `claude mcp add --transport http areca-<slug> <url>`, then `/mcp` > Authenticate.
- **Agency connector (agency admins only):** `https://<cms-host>/api/agency/mcp`, one address for every client and site. Shown on **Agency › Connect AI**. Same sign-in (OAuth, or an agency key with the `areca_mcp_…` prefix).
- Other clients: see [references/connect.md](references/connect.md). It covers Cursor, VS Code/Copilot, Codex, OpenCode, Gemini, Windsurf, ChatGPT, the Claude app and more, plus personal keys (`areca_mcp_…`) for clients without OAuth.

## Agency connector (agency admins)

When the user has the agency connector, use it instead of one connector per site. It reaches every client and every site, production and development.

- **Every site tool takes `site`**, the site slug, for example `acme` or `acme-dev`. There is no current site, so pass `site` on every call. Each result has a `site` object (`slug`, `name`, `client`, `environment`): report where each change happened.
- **Find the slug first.** `list_clients` lists clients. `list_sites({ client? })` lists sites, production and development, with `environment`, `linked` (the production site of a development environment, or its development environment), `publishingMode`, `live` and `pendingReadyChanges`. `find_site({ query })` matches the site name, slug, client name or production URL.
- **Go live needs no flag here.** Still get the user's confirmation, and name the client and site, before any production change. Production changes reach visitors once the site goes live.
- **Environment refusals are normal results.** Go live, rollback, cancel build and scheduling are refused on a development environment ("Push to production first"). `refresh_from_production`, `push_to_production` and `copy_entry_to_production` are refused on a production site ("use the site's dev environment slug"). Take the other site, or explain the refusal.
- **Per-site connector.** If the user has only a site connector, use the connector URL from that site's Connect AI page.

## First calls (always)

1. `get_site_info`: returns your role, what you **cannot** do, the collections, the site content sections (`globals`), the site's publishing mode, whether a deployment target is configured (`deploymentConfigured`) and, on a multilingual site, its `languages`.
2. `get_collection_schema({ collection })`: returns exact field formats, an example payload and SEO guidance. Call it before every first write to a collection. For a site content section, `get_global({ global })` gives the same information.

Tools your role can't use are not listed at all. If the user asks for one of those actions, explain who can do it and don't look for workarounds.

## Workflow and vocabulary

```
create_entry/update_entry -> draft
mark_ready (owner)        -> ready     approved for the next release, NOT live yet
go_live (go-live perm.)   -> live      builds and deploys every ready change
schedule_entry            -> scheduled goes live at a set time (also publishes other ready changes)
```

- `status`: `draft` | `ready` | `scheduled` | `archived`. To answer "what is live" use the flags: `live` (on the production site now), `pendingRelease` (approved changes waiting for the next go live) and `editedSinceReady`.
- Drafts are safe. Nothing changes the live site until an entry is marked ready **and** a go live happens.
- Publishing mode: `production` (go live deploys to the live site) or `demo` (go live builds a release that `areca pull` fetches; demo releases never reach visitors). Agency admins switch it with `set_publishing_mode`. A site that has ever gone live cannot switch to demo, and production needs a deployment target set in Settings › Deployment.
- Only call `mark_ready`, `go_live`, `schedule_entry`, `rollback`, `delete_*`, `archive_entry` or a `push_to_production` that is not a dry run when the user explicitly asks.
- Writes return a `version`. Pass it as `expectedVersion` on the next `update_entry` or `update_global`. On a version conflict, call `get_entry` (or `get_global`), reapply the change and retry.
- `mark_ready` also takes `ids` (up to 200) to approve several entries at once. It returns one result per id, so report the failures.
- Show the user the `previewUrl` that create and update return (it's signed and valid for about 1 hour). If the site has no production URL, preview isn't available.

## Roles

| Role | Can |
| --- | --- |
| editor | read everything, create and edit drafts, upload images, edit alt text, preview |
| owner | everything an editor can, plus `mark_ready`, `unpublish_entry`, `archive_entry`, `cancel_schedule`, `delete_entry`, `restore_revision`, `delete_asset` |
| + go-live permission | `go_live`, `schedule_entry`, `rollback`, `cancel_build`. Granted per connection or key with "Allow going live" (owners and agency admins only). |
| agency admin | everything above, plus `upsert_collection`, `delete_collection`, `upsert_global`, `delete_global`, `set_site_languages`, `set_publishing_mode` (needs 2FA) and the development environment tools (see below). On the agency connector, go live needs no flag, and every site is reachable with `site`. |

## Development environments (agency admins)

A production site can have a **development environment**: a copy of the site that changes are made in first, then pushed to production. Only agency admins can see it.

- **Which connector.** `get_site_info` on the production connector shows `devEnvironment` with its `connectorUrl` when one exists. `get_site_info` on the development connector shows `environment: "development"` and the `productionSlug`. Make the changes on the development connector, then push. On the agency connector, pass the development environment's slug (from `list_sites`) as `site` instead.
- **No releases there.** A development environment has no go live, schedule or rollback tools. Its content reaches the production site only through a push, and a push never deletes production content.
- **Push is a review.** First call `push_to_production` with no arguments. That is a dry run: it writes nothing and returns `items`, `needsAttention` and a `planHash`. Show the list to the user and ask which items to leave out (`exclude`) and which needs-attention items to apply (`apply`). Then call it with `dryRun: false`, the `planHash`, `exclude` and `apply`. If the answer is "The plan changed", run the dry run again.
- **Going live with a push** (`goLive: true`) starts a production build. Only when the user asks, and only with the go-live permission.
- **Copy one entry** with `copy_entry_to_production({ id })`. It becomes the production draft; the live version stays unless `markReady` is set, which also makes the copy the production ready version (ready is not live: a release is still needed). It is refused on a schema mismatch ("Push the schema first") and when production changed since the last sync; use `overwrite` only when the user agrees.
- **Reset** with `refresh_from_production({ confirm: true })`. It discards every unpushed change. Run the dry run first and tell the user how many changes will be lost.
- **New environment.** Ask the user first, and create one only with a yes: `create_dev_environment({ confirm: true })` on the production connector (on the agency connector, pass `site` set to the production slug). It never returns tokens. They are shown once, in the browser that created the environment. Tell the user: open the development environment in the CMS, go to Settings › Developer and rotate the site token (and the schema token for code-first sites) to get new values.

Full tool inputs are in [references/tools.md](references/tools.md#development-environments-agency).

## Writing content

- **Rich text = Markdown**, never HTML (HTML tags show up as literal text). Use `##`, `###` and `####` headings, lists, links, tables and `>` quotes. Images go in as `![alt](asset:<assetId>)`.
- **Code = backticks or fences.** Put inline code (function names, file paths, CLI flags) in backticks. Put code, commands, file contents and config in a fenced block with a language, such as a fence named `ts` or `shell`. Never paste code as plain paragraphs. Language ids: `ts`, `tsx`, `js`, `jsx`, `html`, `css`, `json`, `shell`, `python`, `php`, `sql`, `yaml`, `markdown`, `go`, `rust`, `diff`, and `plaintext` for plain text. Any other language is saved without colours, and the result lists a warning.
- **Images:** pick the path by where the image is (JPEG, PNG, WebP, GIF or PDF, up to 20 MB each):
  - A public *direct* file link: `upload_asset_from_url({ url, altText })`.
  - A local file you can read from a shell: `create_asset_upload`, then `curl -sS -T <file> "<uploadUrl>/"` per file, then `get_asset_upload({ uploadId, finish: true })`. `finish: true` is required; it closes the link.
  - Anything else, such as images the user attached to the chat: `create_asset_upload`, give the user the `pageUrl`, and call `get_asset_upload` when they say they are done.
  - Never ask the user to host an image or share storage credentials.
  - `get_asset_upload` and `get_asset` return previews: look at them, decide which image goes where, and set alt text with `update_asset_alt`. Then use each `assetId` in image fields, `seo.ogImage` and Markdown. If a URL upload fails, don't try other URLs: ask for a working link, offer an upload link, or continue without the image.
- **Field values:** `image` and `reference` take ids, `date` is `YYYY-MM-DD`, `datetime` is ISO 8601 with an offset, `select` must match an option exactly, and `slug` is lowercase with dashes and unique. Date fields are content only and never schedule an entry.
- **Clearing:** use `""` for a field or SEO text, `[]` for SEO lists and `false` for `noindex`/`nofollow`. Avoid `null` (`seo` rejects it). A key you leave out keeps its value.
- **SEO on every new entry:** `seo.title` (50-60 chars), `seo.description` (140-160), `focusKeyphrase`, `summary` (2-3 sentences) and 3-5 `keyTakeaways`. Add `faq` only when the body really answers those questions.
- **Site content (globals):** single sections such as company info or the home page. Read one with `get_global({ global })` and change it with `update_global({ global, fields?, seo?, expectedVersion? })`. It is not a collection, so `create_entry` and `list_entries` do not apply. Its `id` (from `get_global`) works with `mark_ready`, `schedule_entry`, `cancel_schedule`, `list_revisions`, `restore_revision` and `get_preview_url`. Use `discard_global_draft` to go back to the ready values. `seo` is only accepted when the section has SEO on.
- **Schema:** check the first line of the site's `areca.config.ts`. If it is `// Generated by \`areca manifest pull\`.`, the schema is managed in the CMS: change it with `upsert_collection` or `upsert_global`, then run `areca manifest pull`. If the config is hand-written, the schema is in code: change `areca.config.ts` and push it with `areca manifest push`. Both ways replace the whole field list, so send every field.

Full formats, the SEO object, limits and errors are in [references/content.md](references/content.md). Every tool with its inputs is in [references/tools.md](references/tools.md). Multilingual details are in [references/languages.md](references/languages.md).

## Multilingual sites

Only when `get_site_info` returns `languages`. The main language is the fallback; each other language is written on its own.

1. `get_site_info`: note `languages.main`, `languages.all` and each collection's `requiredLanguages`.
2. `create_entry` or `update_entry` (or `update_global`) for the main language, with no `locale`.
3. One `update_entry({ id, locale, fields, seo, slug, expectedVersion })` call per other language. Check `sharedFieldsUpdated` in each response: those fields changed in every language.
4. `get_entry({ id })` and read `translations`. Fill any missing required fields until each language is `complete`.

`mark_ready` refuses an entry until every required language is complete. Only mark ready when the user asks. Details, the `translatable` rules and the errors are in [references/languages.md](references/languages.md).

## Errors

Tool errors come back as normal results with `isError: true` and a message that tells you the next step. Follow it. Common ones:

- `Validation failed`: call `get_collection_schema`.
- `changed since you last read it`: call `get_entry` and retry.
- `Only site owners…` or `Going live…`: tell the user who can do it.
- `is not one of this site's languages`: use a code from `get_site_info`. `This site has one language`: drop `locale`.
- A refusal from `mark_ready` or `schedule_entry` that names languages: fill in those languages with `update_entry` and `locale`.
- `Something went wrong on the Areca server (ref …)`: nothing is confirmed saved. Retry once, then report the ref.

Over HTTP, `401` means sign in again or reconnect. `403 mfa_required` means the agency admin must turn on 2FA. `404 Site not found` on the agency address means the account is not an agency admin, or the address is wrong. `429` means wait for `Retry-After` (120 requests/min per credential; shared across all sites on the agency connector).
