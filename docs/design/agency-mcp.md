# Agency MCP connector

Status: agreed with the product owner on 27 Oct 2026. Not built yet. Delivered as two stacked PRs on top of the development-environments stack (see Rollout).

## Problem

Each site has its own MCP connector (`/api/mcp/<slug>`), and each development environment has another (`/api/mcp/<slug>-dev`). The agency manages many clients, so an agency admin would have to add two connectors per client to their AI app. That does not scale: many apps cap the number of MCP servers, every connector needs its own sign-in, and every connector adds its tool list to the model's context.

The agency connector is one MCP address for agency admins that reaches every client and every site (production and development), with the site chosen per call.

## Decisions

1. **Address.** `/api/agency/mcp`. It cannot collide with a site slug.
2. **Who.** Agency admins only (with MFA, as `requireAgencyAdmin`). Everyone else gets the same 404 as an unknown address. Access is checked live on every request.
3. **Reach.** Every client and every site the agency admin can see, production and development. All reach goes through one central function, `agencyReachableSites(user)` (see "Access groundwork"), which returns everything in v1.
4. **Explicit site per call.** Every site-scoped tool takes a required `site` argument (a site slug, for example `acme` or `acme-dev`). There is no "current site" and no session state. Every result includes `site: { slug, name, client, environment }` so the conversation shows where each change happened. That includes refusals and tool errors once the site is resolved: a success carries the object in its JSON, an error carries it on a first text line (`site: {…}`), and `isError` stays. A site that does not resolve (unknown or unreachable) gets no echo.
5. **Same tools, one definition.** The agency connector exposes every per-site tool with the same name, behaviour and rules, plus the `site` argument. The agency versions are generated from the per-site tool list; nothing is defined twice. A parity test fails when a tool exists on one connector and not the other, or when the schemas differ in anything but `site`. Deliberate exceptions live on a named, tested list (empty in v1).
6. **Navigation tools** (agency connector only): `list_clients`, `list_sites` (optional `client` filter), `find_site` (text search over site name, slug, client name, production URL). The `client` filter takes a client slug first (case-insensitive). Failing that it takes a client name only when exactly one client has that name; two clients with the same name get an error that lists their slugs. An unknown client lists no sites. Each site row: slug, name, client, environment, linked dev env or production site, publishing mode, live state, pending ready changes.
7. **Not in v1:** `create_client`, `create_site` (site tokens are shown once in a browser). `create_dev_environment` stays.
8. **Production writes are allowed**, with the same rights an agency admin has on a per-site connector. The server instructions do **not** tell the model to prefer the dev env; that is the agency admin's choice. The instructions do require the model to name the client and site before a production write and get the user's confirmation.
9. **Environment-specific tools** are listed once and refuse per call when the site's environment does not fit, with a clear message (for example "go_live is not available on development environments. Push to production first.").
10. **Go live without a tick.** On the agency connector, `go_live`, `rollback`, `cancel_build`, `schedule_entry` and `cancel_schedule` need no "Allow going live" flag. Their descriptions say so: the per-site go-live sentence ("Requires a key with the "Allow going live" option." or "Requires permission to go live.") is swapped for "Agency connections can go live; no extra option is needed." in one place, the agency registration (`AGENCY_DESCRIPTION_SWAPS` and `agencyDescription` in `tool-kit.ts`). Per-site connectors are unchanged: an agency admin connecting a single site still ticks "Allow going live" as today.
11. **Credentials.** Personal agency keys and OAuth app connections, stored in the existing `mcp_key` and `mcp_connection` tables with a new `scope` column (`site` | `agency`); `site_id` is null for agency scope (check constraint). Creating an agency key or approving an agency app connection needs a fresh 2FA step-up. Agency key expiry options: 30, 90, 365 days, never (same as site keys). Agency credentials have no go-live option: the stored `allow_go_live` is false and ignored, and every agency call runs with `allowGoLive: true` (Decision 10).
12. **Revocation.** When a user stops being an agency admin, their agency keys and connections are revoked immediately (like `revokeMemberMcpKeys` for site membership).
13. **Rate limit.** Same per-credential budget as today (120/min), shared across all sites.
14. **Audit.** Every action through the agency connector records `via: 'mcp-agency'`, the credential type (`key` | `oauth`) and its name, in addition to the existing key id. The per-site connector also starts recording the credential type.
15. **Legacy `/api/mcp`.** Unchanged.
16. **UI.** A new **Agency › Connect AI** page with everything the site Connect AI page has: the connector address, every app install option and sign-in method (OAuth "Connect an app", personal keys), the keys list, the connected apps list with revoke. The OAuth approval screen for the agency resource says plainly: "This app can read and change every client and site, including production, and go live." No go-live checkbox there.
17. **Docs and skills.** `areca-mcp` and `areca-quickstart` skills, `docs/MCP.md`, `docs/AUTHZ_MATRIX.md`, `docs/ADMIN_GUIDE.md`, `apps/docs` get an agency connector section. The quickstart skill uses the agency connector when the agency admin has one (passing `site` each call) and falls back to the per-site connector.

## Data model

Migration `0038_agency_mcp`:

- `mcp_key.scope text not null default 'site'` (`'site' | 'agency'`); `mcp_key.site_id` becomes nullable; check `(scope = 'site') = (site_id is not null)`.
- `mcp_connection.scope` likewise; `site_id` nullable with the same check. The partial unique index "one active connection per (user, site, client)" gets an agency counterpart: one active agency connection per (user, client).
- Existing rows default to `scope = 'site'`.

## Server

### Access groundwork

`agencyReachableSites(tx | db, user): Promise<Site[]>` and `assertAgencySiteReachable(user, site)` in `src/server/mcp/agency-access.ts`. v1: an agency admin with MFA reaches every site (production and development). Every agency-connector path (tool calls, navigation, consent) goes through these. A test enforces that agency tool calls resolve the site only through `assertAgencySiteReachable`. A later per-admin allow-list changes only this file.

### Connector

- Route `src/routes/api/agency/mcp.ts` → `handleAgencyMcpRequest` in `src/server/mcp/http.ts` (or a new `agency-http.ts`).
- Auth: personal key with `scope = 'agency'`, or an OAuth access token whose resource is `${APP_URL}/api/agency/mcp`, with the `mcp` scope and an active agency connection. Wrong scope (a site key on the agency address or an agency key on a site address) → the address's normal refusal.
- Personal keys are sent as `Authorization: Bearer` only. A key under the `DPoP` scheme gets the same 401 challenge the site connector returns ("Personal keys require Bearer authorization").
- Discovery: protected-resource metadata for the agency resource at the matching well-known path; OAuth authorization accepts the agency resource; consent reference uses the agency connection.
- Actor: the user, role `agency`, `scope: 'agency'`, no fixed site.
- Per tool call: resolve `site` slug → site row → `assertAgencySiteReachable` → build a per-call site actor (`siteId`, `siteSlug`, `organizationId`, `role: 'agency'`, `allowGoLive: true`, credential info) and site context (environment, pairing) → environment check (Decision 9) → run the existing tool with that actor inside the audit context (Decision 14). Once the site row resolves, every result (including refusals and errors) carries the site echo (Decision 4).
- Server instructions: agency-wide text (what the connector is, `site` argument, start with `list_sites` / `find_site`, confirm before production writes, dev env push is dry-run first). No per-site details; `get_site_info({ site })` gives those.

### Tool parity

- The per-site tool registration becomes data: each tool spec (name, description, input schema, access, environments, run) is collected into one list.
- The per-site connector registers the list as today (role/environment filtering at connect time).
- The agency connector registers the same list, adding `site: string` to every input schema (and a note to every description: "Acts on the site named by "site" (the slug from list_sites or find_site). Pass it on every call."), plus the navigation tools. Agency descriptions also get the go-live swap from Decision 10.
- Parity test (`agency-parity.test.ts`): both registries' tool names (minus navigation tools and the named exception list) are equal, for production and for development. Each agency schema, as JSON Schema, equals the per-site schema in the same environment with only the `site` property and its `required` entry removed. Each agency description is the per-site description with the go-live swap plus the site note. No agency description mentions "Allow going live".

## UI

- Route `src/routes/_app/agency/connect-ai.tsx`, screen built from the existing `features/connect-ai/*` components with an agency mode (connector URL, install snippets for every supported app, OAuth connect, keys with step-up and expiry options, connected apps with revoke). Agency nav gets a "Connect AI" item.
- Consent screen: agency variant (title, the full-access sentence, no go-live checkbox, step-up).
- Mobile 390 px and desktop.

## Testing

- Unit: schema wrapping (`site` added), parity test, environment refusal messages, navigation result shapes.
- DB: agency key and OAuth connection auth; non-admin and wrong-scope refusals (404 / normal refusal); revoke on losing agency admin; per-call reachability and dev-site access; go live without a flag on the agency connector and still flag-gated on per-site connectors; audit meta; migration check constraint; the `client` filter (slug first, unique name, shared name refused); the site echo on refusals and errors (none for an unknown site); a personal key under the DPoP scheme refused on both connectors.
- MCP: tools list on the agency connector equals the per-site list + navigation; a write to two different sites in one session lands on the right sites.
- Playwright: Agency › Connect AI — create an agency key (step-up), see it listed, revoke it; connected apps list; desktop and 390 px. A full click-through e2e.

## OAuth (step 2) decisions

Built in step 2 of `feat/agency-mcp-1-server`. Where the build is more specific than the contract above:

- **Resource.** `${APP_URL}/api/agency/mcp`. Its row in `oauth_resource` is named "Areca agency", created on the first authorization request (`ensureMcpResource`). Protected-resource metadata at `/.well-known/oauth-protected-resource/api/agency/mcp` is served `no-store` and names the agency resource only. The agency 401 challenge carries that `resource_metadata`.
- **Authorization.** Exactly one resource per request, either a site resource or the agency resource. A token works only at the resource it names: a site token on the agency address and an agency token on a site address both get a 401 (for an agency admin); for anyone who is not an agency admin, the agency address answers the same 404 as an unknown address.
- **Approval.** Checks run in this order: agency admin, MFA, fresh session (step-up), then the signed query. The server function is `approveAgencyOAuthConsentFn` (no `siteId`, no `allowGoLive`).
- **Generations.** Like the site flow: approving while a usable agency connection exists renews that connection in place (same id, its tokens keep working). Approving when the previous connection is idle or revoked creates a new generation and revokes the old one with its tokens. "Re-approve revokes the previous generation" therefore means the idle case.
- **Consent description.** `describeConsentRequest` returns `kind: 'agency'`, the client, `needsStepUp`, and `warning: { title, body }` already resolved for the request's locale (not a key). The title is "Connect {app} to every client"; the body is the full-access sentence. There is no `site`, no `sites` and no go-live field in the agency variant.
- **Consent screen.** Until the agency consent UI lands (step 2 UI), `/oauth/consent` answers an agency request with a plain refusal and a way back. Site requests are unchanged.
- **Connections.** An agency app is listed and revoked by its owner only (`listAgencyMcpConnectionsFn`, `revokeAgencyMcpConnectionFn`). Losing the agency admin role revokes them with the agency keys (Decision 12).
- **Consent reference.** An agency connection's id, or `agency:pending` when there is no usable connection (never a connection id, so the plugin asks again).

## Rollout

1. **`feat/agency-mcp-1-server`** — migration 0038, credentials scope, connector + OAuth + discovery, tool parity and generation, navigation tools, central access function, audit, revocation, tests.
2. **`feat/agency-mcp-2-ui`** — Agency › Connect AI page, consent screen variant, docs and skills, e2e and screenshots.
