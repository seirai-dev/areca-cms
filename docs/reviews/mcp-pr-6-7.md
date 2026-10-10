# MCP review: merged PRs #6 and #7

Review scope: [#6](https://github.com/ekozf/areca-cms/pull/6), merged as
`7024899ea03f91bd8bf618a1a3ea5c989a56900e`, and
[#7](https://github.com/ekozf/areca-cms/pull/7), merged as
`9de44dc40001ffe9ae47f96d4833a0263272a93e`. Three parallel reviewers inspected
MCP tools, OAuth and its installed provider, and UI/integration behavior. Findings
below concern those changes and their interactions; unrelated historical defects
are excluded. This is a code and regression-test review, not a guarantee that
every possible defect has been found.

Priority: P1 = permission/security or major connection reliability;
P2 = incorrect data or broken expected behavior; P3 = limits/audit/protocol gaps.

## PR #6

| Priority | Finding and trigger | Fix |
| --- | --- | --- |
| P1 | `schedule_entry` required owner access but ignored `allowGoLive`. Scheduling triggers a whole-site release, including other approved changes. | Require go-live access; update tool capabilities, consent/key copy and docs. Test ordinary owner credentials cannot schedule. |
| P2 | `get_entry(includePublished)` returned `publishedData` as `liveFields`. That is the approved candidate, which may be newer than deployment, withdrawn while still live, or inconsistent after rollback. Never-deployed entries also returned live fields. | Read the actual production publication snapshot, preserve its frozen schema/assets, and expose approved fields separately. |
| P2 | Regex asset discovery disagreed with Markdown parsing. Titled images and reference-style images silently disappeared; image examples inside fenced code falsely required an asset. | Collect real image nodes through the Markdown AST, use the same parser semantics as conversion, and reject unresolved actual asset references. |
| P2 | Rich-text-only library images were not included in the asset lookup, so reads failed to normalize their storage URLs to `asset:<id>`. | Gather embedded storage keys for draft, approved and snapshot content. Bulk-load the correct organization's assets. |
| P2 | Ordinary file hyperlinks could be rewritten to unsupported `asset:` links whenever their asset was loaded. | Restrict asset-image URL normalization to actual image markup; preserve ordinary download links. |
| P2 | SEO-only edits reported `editedSinceReady:false`; property-order differences used different semantics from the UI. | Reuse the shared full-data approval comparison, including SEO. |
| P2 | Demo snapshot membership was described as production `live`, despite no production live publication. | Compute MCP live membership from the actual production publication. Demo remains explicit in release status. |
| P2 | Choosing “Never” in the key dialog sent 90 days because `null ?? 90` replaced the intended expiry. | Preserve `null`; browser regression verifies the persisted “Never expires” result. |
| P3 | Active-key count and insert were separate. At nineteen keys, concurrent creations could exceed twenty. | Lock per user/site in a transaction around count, insert and audit. Regression uses eight concurrent requests at nineteen keys. |
| P3 | Asset alt updates/deletes had no AI audit event; schema upserts omitted the authenticated human actor. | Audit these mutations with user, credential name and target; propagate actor to collection upserts and render readable activity verbs. |

Main source areas: `apps/cms/src/server/mcp/{entry-format,keys,release-state}.ts`,
`tools/{entries,entry-workflow,assets,schema}.ts`,
`features/connect-ai/create-key-dialog.tsx` and
`server/content/collections.ts`.

## PR #7 and cross-PR integration

| Priority | Finding and trigger | Fix |
| --- | --- | --- |
| P1 | A real DPoP-bound access token returned 200 from MCP when presented as ordinary Bearer without proof. Token verification discarded confirmation binding. | Implement full DPoP verification using maintained Better Auth helpers: scheme, token hash, bound public key, method/URL, timestamp and an atomic shared replay store. Reject bound tokens presented as Bearer. |
| P1 | Offline access/refresh tokens remained attached to the original browser session. After session expiry, refresh returned 200 but the refreshed token failed MCP with 401. | Separate offline OAuth token lifetime from browser-session lifetime at the adapter boundary; retain live connection and user-access checks. |
| P1 | Authorization could name multiple sites, while consent showed only the first and revocation used only its reference. Old multi-resource tokens could become usable on another reconnect. | Accept one MCP resource per authorization; validate resource inputs consistently and bind tokens to the specific approved connection generation. |
| P1 | Outstanding authorization codes or refresh races could issue credentials after disconnect. Generic `(user, app, site)` matching could make old credentials usable on a later reconnect. | Use a fresh connection generation as the authorization/token reference, gate issuance on its active lifetime and require token-generation equality at MCP. |
| P2 | Reapproval updated only name and go-live flag on an expired non-revoked row. Its timestamps stayed expired; new tokens were unusable. | Replace an expired grant with a fresh generation; require fresh consent, and revoke old-generation credentials. |
| P2 | Refresh could continue indefinitely after MCP inactivity expiry even though the resulting token was unusable. | Check the connection's activity lifetime before refresh and issuance. Only successful MCP requests extend the idle clock. |
| P2 | Consent changed stored permissions before the provider completed consent. A provider rejection could leave go-live changes or a new connection behind. | Reserve the authorization reference without activating a grant; finalize connection permissions only after provider consent succeeds. Serialize approval/disconnect per grant tuple. |
| P2 | Concurrent approvals could both select no active connection and collide at the unique index; approval and disconnect could race on the same row. | Serialize the tuple across approval, token exchange and disconnect; perform connection and audit updates atomically. |
| P2 | Disconnect left rotation replay metadata available. Retrying an already-rotated token within the grace period returned cached token data after revocation. | Revoke all relevant token rows and clear grace/replay metadata; reject disconnected generations before the provider can return a cached response. |
| P2 | The provider's refresh-family replay invalidation was keyed by app/user, logging out all that user's connected sites. | Scope replay invalidation to the affected connection generation and leave other sites usable. |
| P2 | Router JSON decoding changed opaque OAuth state values (`1e3`, large integers, quoted strings, spaced JSON), invalidating signed queries. Real signatures verified before routing and failed afterward. | Preserve every decoded signed-query value as a string, including repeated keys; retain default JSON behavior for ordinary app URLs. |
| P3 | Token rate limits used an unverified client ID as part of the only bucket. Rotating fake IDs bypassed throttling; body parsing was unbounded. | Independent IP/deployment budgets before client bucketing; stream-size cap of 64 KiB, including Basic-auth requests and limiter outages. |
| P3 | Anonymous client logos were fetched before approval, exposing the visiting browser to an app-controlled tracking/private-network URL. | Render a generic icon instead of fetching unverified app branding. |
| P3 | Auth accepted only literal `Bearer ` although HTTP scheme names are case-insensitive. | Share a case-insensitive credential parser; count Bearer and DPoP tokens in the same limiter budget. |

Main source areas: `apps/cms/src/server/mcp/{http,oauth-tokens,oauth-grants,
connections,consent,oauth-resource}.ts`, `lib/{auth,router-search}.ts`,
`server/http/{bearer-token,rate-limit}.ts` and `features/auth/consent-screen.tsx`.

Protocol references: [DPoP (RFC 9449)](https://www.rfc-editor.org/rfc/rfc9449.html),
[HTTP authentication schemes (RFC 9110 §11.1)](https://www.rfc-editor.org/rfc/rfc9110.html#section-11.1).

## Decisions supplied by the user

- Scheduling requires “Allow going live.”
- Ninety-day inactivity counts successful MCP use, not refresh; expiry requires fresh consent.
- Fix all confirmed issues in these two PRs.
- Implement full DPoP support now.
- Refresh replay revokes only the affected site's grant.
- Anonymous apps show a generic icon on consent.

## Boundaries and remaining considerations

- Already accepted schedules remain site workflow state after disconnect or key revocation; granting scheduling authority allows a later whole-site release. Revoking a credential prevents new commands, rather than cancelling earlier accepted work.
- Publishing changes the whole site's approved release, rather than publishing one isolated entry. Consent and tool descriptions should continue making that scope clear.
- The organization library remains shared across its sites, as in the CMS UI. A site-bound AI credential can use organization assets according to the acting user's role.
- Existing tenant checks, live role demotion/removal, draft optimistic concurrency and remote-download DNS/redirect/byte/deadline safeguards were inspected. No confirmed SSRF bypass was found.
- Hosted client end-to-end interoperability still needs a public HTTPS instance and actual ChatGPT/Claude/Cursor/VS Code accounts. Local protocol and browser regressions cannot substitute for that deployment check.
- Redis rate budgets preserve the existing fail-open policy during outages. DPoP replay verification must fail closed if its shared persistence is unavailable.
- Existing OAuth grants tied to site IDs need fresh consent after generation binding is deployed. Personal keys are unaffected by that change.

## Validation

The unchanged targeted baseline passed 300 tests in 14 files after regenerating
ignored Paraglide translations. The final focused run passed 377 tests in 17
files, including actual auth-handler/MCP round trips, DPoP, concurrency and
published snapshot reads. The broader CMS run passed 851 tests, with 646 skipped
by existing suite gates. TypeScript and scoped ESLint passed. The CMS production
build passed; the docs build and 1,434 anchor checks across 66 pages passed.
The owner browser regression verified persisted “Never expires.” All five OAuth
consent browser tests passed: owner/editor approval and tool access, denial,
tampered links and signed-out resume. Their test server's public URLs were
aligned with its localhost origin; no destructive setup/reset was run.
