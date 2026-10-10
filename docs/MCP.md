# Connect AI (MCP)

Connect AI lets an AI app such as Claude Code, Cursor, VS Code or Claude Desktop read and write one Areca site as the signed-in user. The app connects to a per-site MCP endpoint with a personal AI key. The key acts with the user's live role on that site, so it can do exactly what the user can do in the CMS, and nothing more.

This page is the combined guide for editors, owners and agency admins, and the technical reference for the endpoint. The public version is in the docs app under `apps/docs/content/docs/cms/connect-ai.mdx` (for editors) and `apps/docs/content/docs/cms/mcp-tools.mdx` (tool reference).

## Using it

1. Open **Connect AI** in the site's sidebar, or the card on the site Overview. Every site member can open it.
2. Select **Create AI key**. Enter a name, choose the app, choose how long the key lasts (30 days, 90 days, 1 year or never; default 90), and, for owners and agency admins only, choose whether it may **Allow going live**.
3. Copy the key from the one-time screen. Each app tab has a one-click install (Claude Code command, Cursor and VS Code links, Claude Desktop or generic `mcpServers` JSON), and a prompt that any assistant can follow to connect itself. The key is shown once and cannot be recovered.
4. Ask the assistant to read the site (`get_site_info`) and then to write.

ChatGPT and claude.ai in the browser are not supported yet: they require OAuth, and Areca accepts only a bearer key in the `Authorization` header.

## What each role can do

| Capability | Editor | Owner | Owner key with go-live | Agency admin |
| --- | :---: | :---: | :---: | :---: |
| Read site, schema, entries, revisions, library, release status | yes | yes | yes | yes |
| Create entries, edit drafts, preview, get preview URL | yes | yes | yes | yes |
| Upload from URL, list and search library, edit alt text | yes | yes | yes | yes |
| Mark ready, unpublish, archive, delete, restore revision | no | yes | yes | yes |
| Schedule, cancel schedule | no | yes | yes | yes |
| Delete library asset (not in use) | no | yes | yes | yes |
| `go_live`, `rollback`, `cancel_build` | no | no | yes | yes, if the key allows going live |
| `upsert_collection`, `delete_collection` | no | no | no | yes |

Rules:

- Editors cannot create a key with **Allow going live** (the server refuses it). Owners and agency admins can.
- A go-live key stops publishing as soon as its user is no longer an owner or agency admin. The key's flag and the live role are both checked on every request.
- Owners and agency admins see and revoke all keys on the site. Editors see and revoke only their own.
- Agency admins creating a key need a fresh authenticator code (step-up).
- Each user can hold up to 20 active keys per site.
- Keys expire on their expiry date. Revocation is immediate.

## Endpoint and transport

| Item | Value |
| --- | --- |
| URL | `{APP_URL}/api/mcp` (the Server URL on the Connect AI page) |
| Method | `POST` JSON-RPC |
| Transport | MCP Streamable HTTP, stateless, JSON responses |
| Protocol | MCP `2026-07-28` via `createMcpHandler` (`@modelcontextprotocol/server`). 2025-era clients are served too, statelessly (`legacy: 'stateless'`). |
| Auth | `Authorization: Bearer areca_mcp_<43 characters>` on every request |
| Server name | `areca-<site slug>` |
| Max request body | 1 MB |
| Rate limit | 120 requests per minute per key, and 600 per minute per client IP when the IP is known. See [Configuration](#configuration). |

Authentication failures return HTTP `401` with `{"error":"Invalid or expired Areca MCP key"}` and `WWW-Authenticate: Bearer realm="areca-mcp"`. An agency admin whose account has no two-factor sign-in, on an installation with `ADMIN_MFA_REQUIRED` on (the default), gets HTTP `403` with `{"error":"Your account needs two-factor authentication before AI keys work. Turn it on in Account settings.","code":"mfa_required"}`. Keys are checked on every request, so a revoked key stops working at once, even in an open session. Tool errors are not HTTP errors: they return a normal result with `isError: true` and a message written for the model.

The server sends role-specific instructions when a client connects. They say what the key may do (for example, editors are told they cannot mark entries ready), so the model explains refusals instead of trying other tools.

Keys are stored as SHA-256 hashes (`mcp_key.token_hash`), with a display prefix in `mcp_key.token_prefix`. `mcp_key.last_used_at` is written at most once a minute.

## Tools

Tools are registered per request for the caller's role, so a tool the caller cannot use is not advertised and cannot be called.

| Area | Tool | Access | Inputs |
| --- | --- | --- | --- |
| Site | `get_site_info` | everyone | none |
| Site | `get_collection_schema` | everyone | `collection` |
| Entries | `list_entries` | everyone | `collection`, `status?` (`draft`, `ready`, `scheduled`, `archived`), `search?`, `limit?` (1 to 100, default 20), `offset?` |
| Entries | `get_entry` | everyone | `id`, `includePublished?` (adds `liveFields`) |
| Entries | `create_entry` | everyone | `collection`, `fields?`, `seo?` |
| Entries | `update_entry` | everyone | `id`, `fields?`, `seo?`, `expectedVersion?` (at least one of `fields` or `seo`) |
| Entries | `list_revisions` | everyone | `id` |
| Entries | `get_preview_url` | everyone | `id` (about 1 hour; needs a production URL) |
| Library | `list_assets` | everyone | `search?`, `limit?`, `offset?` |
| Library | `get_asset` | everyone | `id` (includes `usageCount`) |
| Library | `upload_asset_from_url` | everyone | `url`, `altText?`, `filename?` |
| Library | `update_asset_alt` | everyone | `id`, `altText` (empty clears) |
| Library | `delete_asset` | owner | `id` (refused while in use) |
| Publishing | `get_release_status` | everyone | none |
| Publishing | `list_publications` | everyone | `limit?` (1 to 50, default 10) |
| Publishing | `get_build_job` | everyone | `jobId` |
| Publishing | `go_live` | go-live key | `note?` (up to 500 characters) |
| Publishing | `rollback` | go-live key | `publicationId` |
| Publishing | `cancel_build` | go-live key | `jobId` (queued builds only) |
| Workflow | `mark_ready` | owner | `id` (does not publish) |
| Workflow | `unpublish_entry` | owner | `id` |
| Workflow | `archive_entry` | owner | `id` |
| Workflow | `schedule_entry` | owner | `id`, `publishAt` (ISO 8601 with offset, future), `timezone` (IANA) |
| Workflow | `cancel_schedule` | owner | `id` |
| Workflow | `delete_entry` | owner | `id` |
| Workflow | `restore_revision` | owner | `id`, `revisionId`, `expectedVersion?` (does not publish) |
| Schema | `upsert_collection` | agency admin | `key`, `label`, `routePattern`, `fields` (complete list), `enabled?` |
| Schema | `delete_collection` | agency admin | `key` (deletes its entries) |

Prompt: `write_post` (arguments `collection`, `topic`) walks the model through reading the schema, drafting Markdown, filling SEO, adding images with alt text, creating a draft and sharing the preview URL. It does not mark ready or go live unless asked.

There is no tool that generates SEO. The model writes the SEO fields itself.

Schema changes made through `upsert_collection` and `delete_collection` are overwritten by the next manifest push on sites that sync their schema from code. Prefer changing `areca.config.ts`.

### Reading entries

Every entry read (`get_entry`, `create_entry`, `update_entry`, `mark_ready` and the other workflow tools) returns the same shape. Collection data is under `fields`; system values sit at the top level, so a field can never collide with them.

| Key | Meaning |
| --- | --- |
| `status` | `draft` (being written), `ready` (approved for the next release), `scheduled` or `archived`. The stored `published` value is reported as `ready`. |
| `live` | `true` when the entry is on the live site now. |
| `pendingRelease` | `true` when approved changes, an approval, a schedule or a withdrawal are waiting for the next go live. |
| `approvedAt`, `scheduledAt`, `scheduleTimezone` | Approval and schedule times, when set. |
| `editedSinceReady` | `true` when the draft differs from the approved version. |
| `previewAvailable` | `true` when the site has a production URL, so `get_preview_url` works. |
| `version` | Pass it as `expectedVersion` on the next write. |
| `liveFields` | Only with `includePublished`: the version visitors see now. |

A `ready` entry can still have `live: false` until the next go live. Editing a ready entry does not change the live site; mark it ready again to approve the new version. `mark_ready` returns a message saying the entry is approved and will go live with the next release.

`get_release_status` returns `pendingChanges`: entries marked ready but not live, scheduled entries, and entries withdrawn since the last go live.

`get_site_info` returns `cannotDo`, a list of sentences describing what this key may not do (for example, "Go live: going live is not enabled for this key"), so the model can tell the user who can act.

## Field formats

Call `get_collection_schema` for the exact format of each field. Summary:

| Type | Format |
| --- | --- |
| `text` | Plain text, up to 1,000 characters |
| `textarea` | Plain text, up to 50,000 characters, no Markdown |
| `richtext` | Markdown (see below). Raw HTML is dropped. |
| `image` | Asset id from `list_assets` or `upload_asset_from_url` |
| `reference` | Entry id from `list_entries` in the referenced collection |
| `date` | `YYYY-MM-DD` |
| `datetime` | ISO 8601 with offset, e.g. `2026-10-10T09:00:00+02:00` |
| `select` | One of the listed options, spelled exactly |
| `slug` | Lowercase letters, numbers and dashes; unique per collection; up to 200 characters |
| `boolean` / `number` | JSON `true`/`false` or a JSON number |
| `url` | Absolute `http` or `https` URL |

To clear a field on update, send an empty string `""` (for any type; an empty text field is stored as empty). Do not send `null` or omit the key expecting a clear, because omitted keys keep their value. Unknown field keys are refused and the error lists the valid keys.

The slug is the field of type `slug` in the collection (usually `slug`). Send it inside `fields`, lowercase letters, numbers and dashes, unique within the collection. Date and datetime fields are content, such as an event date. They never publish or schedule an entry; use `schedule_entry` for that.

**Rich text** is Markdown: `##` for sections, `###` or `####` for subsections, blank lines between paragraphs, `**bold**`, `*italic*`, links, lists, blockquotes and tables. Images are `![alt text](asset:<assetId>)`; the asset must exist in the organization's library or the write is refused. Reads return the same form, with stored image links rewritten to `asset:<id>`.

**SEO** (`seo` object, all keys optional, unknown keys refused). To clear a key on update, send `""` for text keys, `false` for `noindex` and `nofollow`, and `[]` for lists. Do not send `null`. Keys: `title` (300 max, aim for 50 to 60), `description` (1,000 max, aim for 140 to 160), `focusKeyphrase` (200), `canonicalUrl` (URL), `noindex`, `nofollow`, `ogTitle` (300), `ogDescription` (1,000), `ogImage` (asset id), `twitterCard` (`summary_large_image` or `summary`), `schemaType` (`Article`, `BlogPosting`, `NewsArticle`, `WebPage`), `summary` (2,000), `keyTakeaways` (up to 12 items, 500 each), `faq` (up to 20 `{question, answer}`; 500 and 3,000 characters), `about` (up to 12 `{name, sameAs}`), `author` (`{name, url, bio}`; bio 1,000; send an empty `name` to remove the author), `jsonLd` (extra schema.org JSON as a string, up to 20,000 characters; usually leave unset, because the CMS writes the main node from the other keys).

## Uploads from a URL

`upload_asset_from_url` downloads one file and stores it in the organization's library. It accepts only JPEG, PNG, WebP, GIF or PDF content, judged by the bytes rather than the `Content-Type` header. It refuses:

- files over 20 MB,
- links that are not `http` or `https`, use a port other than 80, 443, 8080 or 8443, or contain a username or password,
- private, loopback, link-local and other non-public addresses, checked at connect time for every resolved address and every redirect hop,
- more than 3 redirects, or a download that takes longer than 15 seconds.

Failures come back as `Could not import the file: …` with one of these messages: unsupported file type, a web page (`text/html`) instead of a file, a file type other than image or PDF, a file over 20 MB, a port that is not allowed, a username or password in the link, a private or local address, an unresolvable domain, an unreachable server, a redirect loop, a timeout, or an HTTP error from the host (4xx says the link is not a direct file link; 5xx says the server failed and may be down).

Each import is recorded in the activity log as `asset.upload` ("uploaded … to the Library").

There is no base64 or multipart upload.

## Errors

Common tool error messages and what they mean:

| Message | Meaning |
| --- | --- |
| `Validation failed. …` | Field missing, unknown or malformed. Re-read the schema and retry. |
| `This entry changed since you last read it…` (`DRAFT_CONFLICT`) | `expectedVersion` is stale. Re-read with `get_entry` and reapply. |
| Slug conflict | Slug already used in the collection. |
| `This asset is still used by N item(s)` | `delete_asset` refused. |
| `Could not import the file: …` | Upload from URL refused (see above). |
| `Only site owners can …` / `Going live is not enabled for this key…` / `Only agency admins can …` | Role or key does not allow it. The message says who can. |
| `No entry with id …` / `No collection …` | Not on this site. Use the list tool to find valid ids. |
| `Something went wrong on the Areca server (ref …)` | Unexpected failure. Nothing is confirmed as saved. The ref is in the server log. |

Not found and forbidden answers follow the rules in `AUTHZ_MATRIX.md`: objects on another site look the same as missing ones.

## Activity and audit

Each MCP tool call runs inside `withAuditContext({ via: 'mcp', mcpKeyId, mcpKeyName })`, so every audit row written by the call carries that metadata. The activity log shows these actions as **via AI · <key name>**. Audit metadata holds the action, key name and identifiers, not the content text.

Key creation and revocation are audited as `mcp_key.create` and `mcp_key.revoke`.

## Configuration

- **`APP_URL`** sets the origin of the endpoint shown on the Connect AI page (`APP_URL` + `/api/mcp`). Set it to the public CMS origin, or the install snippets will point at an address the AI app cannot reach. See [CONFIGURATION.md](CONFIGURATION.md).
- **`RATE_LIMIT_TRUST_PROXY`** decides whether the per-IP budget (600 a minute) applies to `/api/mcp`. Without a trusted proxy the client IP is unknown, so only the per-key budget (120 a minute) applies. Set it to `true` only behind a proxy that sets the client address header.
- **`ADMIN_MFA_REQUIRED`** (default `true`): an agency admin without two-factor sign-in gets `403` with `mfa_required` on every key.

## Code map

| Path | Role |
| --- | --- |
| `apps/cms/src/routes/api/mcp.ts` | Route: POST, GET, DELETE to the handler |
| `apps/cms/src/server/mcp/http.ts` | Bearer parsing, actor resolution, 401, SDK handler (stateless, JSON) |
| `apps/cms/src/server/mcp/keys.ts` | Key generation, hashing, create, list, revoke, `resolveMcpActor` |
| `apps/cms/src/server/mcp/server.ts` | Server instructions, registration, `write_post` prompt |
| `apps/cms/src/server/mcp/tool-kit.ts`, `guard.ts`, `scope.ts`, `errors.ts` | Tool registry, access checks, tenancy lookups, error mapping |
| `apps/cms/src/server/mcp/tools/*.ts` | The tools, grouped by area |
| `apps/cms/src/server/mcp/entry-format.ts`, `schemas.ts`, `schema-docs.ts` | Field conversion, SEO schema, agent-facing format docs |
| `apps/cms/src/server/assets/remote.ts` | SSRF-safe download and `uploadAssetFromUrl` |
| `apps/cms/src/server/richtext/from-markdown.ts` | Markdown to stored rich text |
| `apps/cms/src/server/fn/mcp-keys.ts` | Server functions for the Connect AI page |
| `apps/cms/src/lib/mcp-install.ts` | Install snippets per app |
| `apps/cms/src/features/connect-ai/` | Connect AI page UI |
