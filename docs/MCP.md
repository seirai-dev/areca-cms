# Connect AI (MCP)

Connect AI lets an AI app such as ChatGPT, Claude, Claude Code, Cursor or VS Code read and write one Areca site as the signed-in user. Each site has one connector URL, `{APP_URL}/api/mcp/<site-slug>`. The app signs in with OAuth 2.1 in the browser, and the user approves it on a consent screen. The app then acts with the user's live role on that site, so it can do exactly what the user can do in the CMS, and nothing more.

Personal AI keys still work for scripts, CI and clients that cannot sign in through a browser. They are under **Advanced: personal keys** on the Connect AI page.

This page is the combined guide for editors, owners and agency admins, and the technical reference for the endpoints. The public version is in the docs app: `apps/docs/content/docs/cms/connect-ai.mdx` (for users) and `apps/docs/content/docs/cms/mcp-tools.mdx` (tool and sign-in reference).

## Using it

1. Open **Connect AI** in the site's sidebar, or the card on the site Overview. Every site member can open it.
2. Under **Your connector URL**, select **Copy connector URL**.
3. Add the URL in your AI app, following the guide for that app: ChatGPT, Claude (custom connector), Claude Code (`claude mcp add --transport http …`, then `/mcp`), Cursor (**Add to Cursor**), VS Code (**Add to VS Code**), or any app that takes a remote MCP server URL.
4. The app opens a browser window. Sign in to Areca, check the consent screen and select **Allow** (owners and agency admins can also tick **Allow going live**, which lets the app publish the whole site; it is off by default). Agency admins are asked for a fresh authenticator code first.
5. Ask the assistant to read the site (`get_site_info`) and then to write.

Connected apps are listed under **Connected apps** on the same page, with **Disconnect**. Editors see their own connections; owners and agency admins see all connections on the site.

ChatGPT and Claude connect from the internet, so the CMS must be reachable on its public HTTPS address. Claude Code, Cursor and VS Code need HTTPS for any address except `localhost`.

## What each role can do

| Capability | Editor | Owner | Owner, publishing allowed | Agency admin |
| --- | :---: | :---: | :---: | :---: |
| Read site, schema, entries, revisions, library, release status | yes | yes | yes | yes |
| Create entries, edit drafts, preview, get preview URL | yes | yes | yes | yes |
| Upload from URL, list and search library, edit alt text | yes | yes | yes | yes |
| Mark ready, unpublish, archive, delete, restore revision | no | yes | yes | yes |
| Schedule, cancel schedule | no | yes | yes | yes |
| Delete library asset (not in use) | no | yes | yes | yes |
| `go_live`, `rollback`, `cancel_build` | no | no | yes | yes, if the app or key may publish |
| `upsert_collection`, `delete_collection` | no | no | no | yes |

Rules:

- Editors cannot allow publishing, either on the consent screen or on a key (the server refuses it). Owners and agency admins can.
- A connection or key allowed to publish stops publishing as soon as its user is no longer an owner or agency admin. The app's flag and the live role are both checked on every request.
- Owners and agency admins see and disconnect or revoke all connected apps and keys on the site. Editors see and revoke only their own.
- Agency admins approving a connection, or creating a key, need a fresh authenticator code (step-up).
- Each user can hold up to 20 active personal keys per site.
- Connections last until disconnected, or until 90 days without use. Keys expire on their expiry date. Disconnect and revocation are immediate.

## Endpoints and transport

| Item | Value |
| --- | --- |
| Connector URL (per site) | `{APP_URL}/api/mcp/<site-slug>`, shown on the Connect AI page. Accepts OAuth access tokens issued for this site, and personal keys for this site. |
| Key endpoint | `{APP_URL}/api/mcp`. Accepts personal keys only (`Authorization: Bearer areca_mcp_<43 characters>`); the key's site is used. OAuth tokens are refused here. |
| Methods | `POST` (JSON-RPC), `GET` and `DELETE` (Streamable HTTP) |
| Transport | MCP Streamable HTTP, stateless, JSON responses |
| Protocol | MCP `2026-07-28` via `createMcpHandler` (`@modelcontextprotocol/server`). 2025-era clients are served too, statelessly (`legacy: 'stateless'`). |
| Server name | `areca-<site slug>` |
| Max request body | 1 MB |
| Rate limit | 120 requests per minute per access token or key, and 600 per minute per client IP when the IP is known. See [Configuration](#configuration). |

Cookies are not accepted. Tool errors are not HTTP errors: they return a normal result with `isError: true` and a message written for the model.

The server sends role-specific instructions when a client connects. They say what the caller may do (for example, editors are told they cannot mark entries ready), so the model explains refusals instead of trying other tools.

## Authentication

### OAuth sign-in (connected apps)

The CMS is an OAuth 2.1 authorization server, built with `@better-auth/oauth-provider` (Better Auth 1.7). It follows the MCP authorization specification, and the connector URL is a protected resource. Decisions are recorded in [DECISIONS.md](DECISIONS.md#ai-apps-connect-ai-mcp).

| Step | Request | Result |
| --- | --- | --- |
| Challenge | `POST`/`GET` `{APP_URL}/api/mcp/<slug>` with no token | `401`, `WWW-Authenticate: Bearer resource_metadata="{APP_URL}/.well-known/oauth-protected-resource/api/mcp/<slug>", scope="mcp offline_access"` |
| Protected resource metadata (RFC 9728) | `GET {APP_URL}/.well-known/oauth-protected-resource/api/mcp/<slug>` | `resource` (the connector URL), `authorization_servers: ["{BETTER_AUTH_URL}/api/auth"]`, `scopes_supported`, `bearer_methods_supported: ["header"]`, `resource_name`. `404` for unknown slugs. |
| Authorization server metadata (RFC 8414) | `GET {BETTER_AUTH_URL}/.well-known/oauth-authorization-server/api/auth` | Issuer `{BETTER_AUTH_URL}/api/auth`, endpoints, `code_challenge_methods_supported: ["S256"]`, `authorization_response_iss_parameter_supported: true`. Also under `/api/auth/.well-known/…`. |
| OpenID configuration | `GET {BETTER_AUTH_URL}/.well-known/openid-configuration/api/auth` | Same issuer. Root-level documents (no `/api/auth` path) are not served. |
| Registration (RFC 7591) | `POST {BETTER_AUTH_URL}/api/auth/oauth2/register` | Open to anonymous clients; registers a public client (no secret). Redirect URIs: `https` anywhere, `http` only for `localhost`, `127.0.0.1` and `[::1]`. Client ID Metadata Documents (CIMD) are not supported yet. Rate limited. |
| Authorization | `GET {BETTER_AUTH_URL}/api/auth/oauth2/authorize` | Needs `response_type=code`, `client_id`, `redirect_uri`, `scope` (must include `mcp`), `resource` (RFC 8707, the connector URL), `code_challenge` with `code_challenge_method=S256`, and `state`. Sign-in at `/login`, then consent at `/oauth/consent`. |
| Token | `POST {BETTER_AUTH_URL}/api/auth/oauth2/token` | `grant_type=authorization_code` (with `code_verifier` and `resource`) or `refresh_token`. Rate limited. |
| Revocation / introspection / user info | `POST …/oauth2/revoke`, `POST …/oauth2/introspect`, `GET …/oauth2/userinfo` | RFC 7009 and RFC 7662 endpoints of the plugin. Disconnecting in the CMS revokes the same tokens. |

The authorization response carries `iss` (RFC 9207) set to the issuer, so clients can check which server answered.

Scopes: `mcp` is the only scope the MCP endpoint checks, and it is required (`403 insufficient_scope` without it). `offline_access` is needed for refresh tokens. `openid`, `profile` and `email` are accepted and advertised because common clients request them, but they are not used for access.

Lifetimes and tokens:

- Access tokens are opaque, prefix `areca_at_`, and last 1 hour.
- Refresh tokens are opaque, prefix `areca_rt_`, last 90 days from their last use, and rotate on every refresh.
- Refresh reuse window: 30 seconds. A retry inside the window gets the same tokens back. Reusing a rotated refresh token after the window is treated as replay: the server revokes the affected site’s connection generation and its access and refresh tokens. Other sites connected to the same app remain usable; the affected site needs fresh consent. Dead refresh tokens return `invalid_grant`.
- Tokens are stored as SHA-256 hashes (`storeTokens: "hashed"`, the plugin default). Access tokens are checked against the database on each request, so revocation is immediate.
- A connection (`mcp_connection`) is valid while it is not revoked and has had successful MCP use within 90 days (or was approved within that window). Refresh alone does not extend this activity window. Offline OAuth tokens outlive the browser login session; live user permissions are still checked for every MCP request. Access tokens are bound to a resource (RFC 8707): a token for one site is refused at another.

Consent is per site: the consent reference is the unique approved connection generation for the single site named in `resource`, so an approval for one site does not cover another. The approval also creates or updates the `mcp_connection` row that each request checks.

On each request the endpoint checks, in order: the token exists, is unexpired and unrevoked, names this site as its resource, and carries `mcp`; an active connection exists for (user, app, site) and matches the token’s approval generation; the user still exists and has a live role on the site (agency admins also need two-factor sign-in when `ADMIN_MFA_REQUIRED` is set). Then it runs the tool with that role.

### DPoP clients

Clients may register `dpop_bound_access_tokens: true` and send DPoP proofs at the token endpoint. Bound tokens must be sent to MCP as `Authorization: DPoP <token>` with a fresh `DPoP` proof. The resource verifies the proof signature, bound public key, HTTP method, public connector URL, access-token hash and a 60-second proof age. Proof IDs are reserved atomically in the shared authentication database, so replay is rejected across replicas. Verification fails closed if that store is unavailable. Server-provided nonces are optional and are not required; accepted signing algorithms are advertised in resource metadata. Ordinary Bearer clients remain supported.

### Personal keys

A personal key is `areca_mcp_` followed by 43 random characters. Keys are stored as SHA-256 hashes (`mcp_key.token_hash`), with a display prefix in `mcp_key.token_prefix`. They are shown once and checked on every request. A key works on the connector URL of its own site and on `/api/mcp`. On the connector URL of another site it is refused with `401`.

Keys are sent as `Authorization: Bearer areca_mcp_…`. `mcp_key.last_used_at` is written at most once a minute.

### Errors

| Status | Endpoint | Meaning |
| --- | --- | --- |
| `401` | connector URL | No bearer credential. The body is `{"error":"Sign in to connect to this site"}`, with the `resource_metadata` challenge above. |
| `401` | connector URL | `invalid_token`: the access token is invalid, expired or revoked, was issued for another site, or the app is no longer connected to the site, or the user no longer has access. The challenge also carries `resource_metadata`. |
| `403` | connector URL | `insufficient_scope`: the token has no `mcp` scope. |
| `401` | `/api/mcp` | `{"error":"Invalid or expired Areca MCP key"}` with `WWW-Authenticate: Bearer realm="areca-mcp"`, for a missing, malformed, unknown, revoked or expired key, or a user who is no longer a member. |
| `403` | both | `{"error":"Your account needs two-factor authentication before AI keys work. Turn it on in Account settings.","code":"mfa_required"}` for an agency admin without two-factor sign-in, when `ADMIN_MFA_REQUIRED` is on (the default). |
| `404` | connector URL | Unknown site slug. |
| `429` | both | Rate limit exceeded, with `Retry-After`. See [Configuration](#configuration). |

A client that gets `401` with `invalid_token` should refresh its access token, and start sign-in again if the refresh fails. Keys are checked on every request, so a revoked key or disconnected app stops working at once, even in an open session.

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
| Workflow | `schedule_entry` | go-live permission | `id`, `publishAt` (ISO 8601 with offset, future), `timezone` (IANA) |
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
| `live` | `true` when the entry is in the production live publication. Demo previews do not count; inspect `get_release_status.demo` for the demo publication. |
| `pendingRelease` | `true` when approved changes, an approval, a schedule or a withdrawal are waiting for the next go live. |
| `approvedAt`, `scheduledAt`, `scheduleTimezone` | Approval and schedule times, when set. |
| `editedSinceReady` | `true` when the draft differs from the approved version. |
| `previewAvailable` | `true` when the site has a production URL, so `get_preview_url` works. |
| `version` | Pass it as `expectedVersion` on the next write. |
| `liveFields` | Only with `includePublished`: fields from the actual live publication, or `null` if this entry is not live. Demo previews are not reported as live fields. |
| `approvedFields` | Only with `includePublished`: the approved version waiting for release, separate from the live publication. |

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
| `Only site owners can …` / `Going live wasn't allowed when this app was connected.` (or `Going live is not enabled for this key.`) / `Only agency admins can …` | Role or key does not allow it. The message says who can. |
| `No entry with id …` / `No collection …` | Not on this site. Use the list tool to find valid ids. |
| `Something went wrong on the Areca server (ref …)` | Unexpected failure. Nothing is confirmed as saved. The ref is in the server log. |

Not found and forbidden answers follow the rules in `AUTHZ_MATRIX.md`: objects on another site look the same as missing ones.

## Activity and audit

Each MCP tool call runs inside `withAuditContext({ via: 'mcp', mcpKeyId, mcpKeyName })`, where `mcpKeyId` and `mcpKeyName` hold the connection's id and the connected app's name for OAuth connections, and the key's id and name for keys. The activity log shows these actions as **via AI · <app name>**. Audit metadata holds the action, the name and identifiers, not the content text.

Connecting an app to a site is audited as `mcp_connection.create` (the activity log: "connected … to the site"), and disconnecting as `mcp_connection.revoke`. Key creation and revocation are audited as `mcp_key.create` and `mcp_key.revoke`.

## Configuration

- **`APP_URL`** sets the origin of each connector URL (`APP_URL` + `/api/mcp/<slug>`), and the protected resource metadata. Set it to the public HTTPS origin, or the connector URLs will point at an address the AI app cannot reach.
- **`BETTER_AUTH_URL`** is the OAuth issuer (`BETTER_AUTH_URL` + `/api/auth`), and the origin of the authorization server's discovery documents. Use the same public HTTPS origin as `APP_URL`. A mismatch breaks sign-in. See [CONFIGURATION.md](CONFIGURATION.md).
- **Reverse proxy.** The proxy must forward `/.well-known/*`, `/api/auth/*` and `/api/mcp/*` to the CMS. See [DEPLOYMENT.md](DEPLOYMENT.md#ai-apps-need-public-https).
- **`RATE_LIMIT_TRUST_PROXY`** decides whether the per-IP budgets apply. Without a trusted proxy the client IP is unknown, so `/api/mcp` and `/api/mcp/<slug>` apply only the per-credential budget (120 a minute), and the OAuth registration per-address limit (20 an hour) is skipped. The deployment-wide registration limit (300 an hour) and the token limit (60 a minute per app, and per client address when it is known) still apply. Set it to `true` only behind a proxy that sets the client address header.
- **`ADMIN_MFA_REQUIRED`** (default `true`): an agency admin without two-factor sign-in gets `403` with `mfa_required` on every connector URL and key, and cannot approve a connection.

## Code map

| Path | Role |
| --- | --- |
| `apps/cms/src/lib/auth.ts` | Better Auth with `oauthProvider` (opaque tokens, PKCE `S256`, DCR, `login`/`consent` pages, per-site consent reference, resource hooks) |
| `apps/cms/src/server/mcp/oauth-resource.ts` | Scopes, token lifetimes and prefixes, per-site resource URLs, `ensureMcpSiteResource` |
| `apps/cms/src/server/mcp/oauth-registration.ts` | Registration normalisation (`application_type` native for loopback clients, full scope set) |
| `apps/cms/src/server/mcp/oauth-tokens.ts` | Verifies access tokens through the plugin's API (expiry, revocation, client) |
| `apps/cms/src/server/mcp/discovery.ts` | Discovery documents at the origin root (AS, OIDC and protected resource metadata); dispatched from `apps/cms/src/server.ts` |
| `apps/cms/src/server/mcp/consent.ts` | Consent: signed query check, access check, step-up for agency admins, approve and deny |
| `apps/cms/src/server/mcp/connections.ts` | `mcp_connection` rows: create on approval, list, disconnect (revokes tokens and consent), 90-day idle rule |
| `apps/cms/src/server/mcp/site-access.ts` | Site access for Connect AI pages and their server functions |
| `apps/cms/src/server/mcp/http.ts` | Per-site endpoint (`handleSiteMcpRequest`), key endpoint (`handleMcpRequest`), challenges, actor construction, SDK handler (stateless, JSON) |
| `apps/cms/src/server/mcp/keys.ts` | Key generation, hashing, create, list, revoke, `resolveMcpActor`, live role |
| `apps/cms/src/server/mcp/server.ts` | Server instructions, registration, `write_post` prompt |
| `apps/cms/src/server/mcp/tool-kit.ts`, `guard.ts`, `scope.ts`, `errors.ts` | Tool registry, access checks, tenancy lookups, error mapping |
| `apps/cms/src/server/mcp/tools/*.ts` | The tools, grouped by area |
| `apps/cms/src/server/mcp/entry-format.ts`, `schemas.ts`, `schema-docs.ts` | Field conversion, SEO schema, agent-facing format docs |
| `apps/cms/src/server/assets/remote.ts` | SSRF-safe download and `uploadAssetFromUrl` |
| `apps/cms/src/server/richtext/from-markdown.ts` | Markdown to stored rich text |
| `apps/cms/src/routes/api/mcp/$siteSlug.ts` | Route: per-site connector URL, POST, GET, DELETE |
| `apps/cms/src/routes/api/mcp/index.ts` | Route: personal-key endpoint `/api/mcp`, POST, GET, DELETE |
| `apps/cms/src/routes/oauth/consent.tsx` | Consent page at `/oauth/consent` |
| `apps/cms/src/server/http/rate-limit.ts` | Rate limits for `/api/mcp*`, OAuth registration and token |
| `apps/cms/src/server/fn/mcp-keys.ts`, `mcp-oauth.ts` | Server functions for keys, consent and connected apps |
| `apps/cms/src/lib/mcp-install.ts` | Connector and install snippets per app |
| `apps/cms/src/features/connect-ai/` | Connect AI page UI (connector URL, per-app steps, connected apps, Advanced personal keys) |
| `apps/cms/src/features/auth/consent-screen.tsx` | Consent screen UI |

Scheduling requires **Allow going live** because the scheduler deploys the site at the chosen time, including other approved changes. Cancelling a schedule remains an owner action. Rich-text image references accept ordinary Markdown titles and reference-style syntax; image examples inside code are not treated as assets.
