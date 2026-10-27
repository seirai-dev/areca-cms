# Authorization matrix

Source of truth: `apps/cms/src/server/security/authz-matrix.ts` (data) executed by
`authz-matrix.test.ts` (server functions) and `authz-routes.test.ts` (HTTP routes).
Both run the real guards (`session.server.ts`, `step-up.ts`) against a real
PostgreSQL database seeded with two tenants, bypassing the UI. Adding a server
function or an `src/routes/api/**` file without a matrix entry fails the
inventory tests.

Role precedence: agency admin > org owner > org editor. Agency admins must have
two-factor (`MFA_REQUIRED` otherwise). Step-up actions additionally need a
session created or re-verified in the last ten minutes (`REAUTH_REQUIRED`).

## Actors

| Actor | Meaning |
| --- | --- |
| anonymous | no session |
| editorX | editor of org X |
| ownerX | owner of org X |
| ownerY | owner of an unrelated org Y (cross-tenant caller; targets X data) |
| adminNoMfa | agency admin without two-factor |
| adminMfa | agency admin with two-factor, fresh session |
| adminStale | agency admin with two-factor, session 30 min old, no re-verification |

## Policies

| Policy | anonymous | editorX | ownerX | ownerY | adminNoMfa | adminMfa | adminStale |
| --- | --- | --- | --- | --- | --- | --- | --- |
| public | allow | allow | allow | allow | allow | allow | allow |
| user | redirect /login | allow | allow | allow | allow | allow | allow |
| org-editor | redirect /login | allow | allow | 403 | MFA_REQUIRED | allow | allow |
| org-owner | redirect /login | 403 | allow | 403 | MFA_REQUIRED | allow | allow |
| agency | redirect /login | 403 | 403 | 403 | MFA_REQUIRED | allow | allow |
| agency-fresh | redirect /login | 403 | 403 | 403 | MFA_REQUIRED | allow | REAUTH_REQUIRED |

Denied calls must also (a) return no result and (b) leave the target resource
unchanged (each row carries a side-effect probe).

## Server functions (`src/server/fn/*.ts`)

| Function | File | Policy | Who may call |
| --- | --- | --- | --- |
| `listOrganizationsFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `createOrganizationFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `updateOrganizationFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `deleteOrganizationFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `getDokployCredentialStatusFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `saveDokployCredentialsFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `verifyDokployCredentialsFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `removeDokployCredentialsFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `listSitesFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `getSiteFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `createSiteFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `updateSiteFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `rotateSiteTokenFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up); rotates the build or schema token according to `privilege` |
| `deleteSiteFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `getDevEnvironmentFn` | `dev-env.ts` | `agency` | agency admin (MFA); a production site's development environment, or null |
| `createDevEnvironmentFn` | `dev-env.ts` | `agency` | agency admin (MFA); no step-up (throwaway dev env); production sites only |
| `refreshDevEnvironmentFn` | `dev-env.ts` | `agency` | agency admin (MFA); no step-up; discards the dev env's content and forks again |
| `deleteDevEnvironmentFn` | `dev-env.ts` | `agency` | agency admin (MFA); no step-up; deletes the dev env, nothing is archived |
| `getDevSiteSyncStatusFn` | `dev-env.ts` | `agency` | agency admin (MFA); unpushed and production change counts of a dev env |
| `getPushPlanFn` | `dev-env.ts` | `agency` | agency admin (MFA); the push plan items and the plan hash of a dev env. Writes nothing |
| `pushToProductionFn` | `dev-env.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up); pushes the selected plan items to production; refused when the plan hash is stale |
| `copyEntryToProductionFn` | `dev-env.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up); copies one dev entry or section to production as its draft; refused on a schema mismatch, on a production change since the last sync (unless `overwrite`), and on a scheduled production entry |
| `listMembersFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `updateMemberRoleFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `removeMemberFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `inviteMemberFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listInvitationsFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `revokeInvitationFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `resendInvitationFn` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listAuditLogFn (organizationId)` | `admin.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listAuditLogFn (instance-wide)` | `admin.ts` | `agency` | agency admin (MFA) |
| `setAgencyAdminFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `listUsersFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `listPendingInvitationsFn` | `admin.ts` | `agency` | agency admin (MFA) |
| `getUserDetailFn` | `people.ts` | `agency` | agency admin (MFA) |
| `blockUserFn` | `people.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `unblockUserFn` | `people.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `deleteUserFn` | `people.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `resetUserTwoFactorFn` | `people.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `signOutUserEverywhereFn` | `people.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `updateUserNameFn` | `people.ts` | `agency` | agency admin (MFA) |
| `setUserClientAccessFn` | `people.ts` | `agency` | agency admin (MFA) |
| `bulkBlockUsersFn` | `people.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `bulkUnblockUsersFn` | `people.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `bulkSignOutUsersFn` | `people.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `bulkAddUsersToClientsFn` | `people.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `searchPeopleFn` | `people.ts` | `agency` | agency admin (MFA) |
| `listCollectionsFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `listEntriesFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `getEntryFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `listInboundReferencesFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `createEntryFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `updateDraftFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `publishEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `unpublishEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `archiveEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `bulkEntryActionFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA); ready, draft, archive or delete for up to 200 ids of one site, each id with the rules of its single action and its own result (not all-or-nothing) |
| `cancelScheduleFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `scheduleEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `deleteEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listRevisionsFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `restoreRevisionFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `getPreviewUrlFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `upsertCollectionFn` | `content.ts` | `agency` | agency admin (MFA) |
| `deleteCollectionFn` | `content.ts` | `agency` | agency admin (MFA) |
| `listGlobalsFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA); disabled site content only for agency admin |
| `getGlobalFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA); disabled site content only for agency admin |
| `getGlobalPreviewUrlFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA); disabled site content only for agency admin |
| `updateGlobalDraftFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA); disabled site content only for agency admin |
| `discardGlobalDraftFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA); disabled site content only for agency admin |
| `upsertGlobalFn` | `content.ts` | `agency` | agency admin (MFA) |
| `setGlobalEnabledFn` | `content.ts` | `agency` | agency admin (MFA) |
| `deleteGlobalFn` | `content.ts` | `agency` | agency admin (MFA) |
| `listAssetsFn` | `assets.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `getAssetFn` | `assets.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `updateAssetFn` | `assets.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `deleteAssetFn` | `assets.ts` | `org-owner` | org owner, agency admin (MFA) |
| `requestPublicationFn` | `publishing.ts` | `org-owner` | org owner, agency admin (MFA) |
| `requestRollbackFn` | `publishing.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listPublicationsFn` | `publishing.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `listBuildJobsFn` | `publishing.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `getBuildJobFn` | `publishing.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `cancelJobFn` | `publishing.ts` | `org-owner` | org owner, agency admin (MFA) |
| `reconcileDeploymentJobFn` | `publishing.ts` | `org-owner` | org owner, agency admin (MFA) |
| `resolveUncertainDeploymentJobFn` | `publishing.ts` | `agency` | agency admin (MFA); reason and upstream-stop confirmation required |
| `getSiteReleaseStatusFn` | `publishing.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `getBrandingFn` | `branding.ts` | `public` | anyone |
| `updateBrandingFn` | `branding.ts` | `agency` | agency admin (MFA) |
| `clearBrandingImageFn` | `branding.ts` | `agency` | agency admin (MFA) |
| `resetBrandingFn` | `branding.ts` | `agency` | agency admin (MFA) |
| `getAiSettingsFn` | `ai.ts` | `agency` | agency admin (MFA); never returns the API key |
| `saveAiSettingsFn` | `ai.ts` | `agency` | agency admin (MFA); `agency-fresh` when the API key is set or removed |
| `listAiModelsFn` | `ai.ts` | `agency` | agency admin (MFA) |
| `getAiAvailabilityFn` | `ai.ts` | `user` | any signed-in user (boolean only) |
| `generateEntrySeoFn` | `ai.ts` | `org-editor` | org member (editor/owner) or agency admin; NotFound outside the org; 30/hour per user |
| `verifyStepUpFn` | `security.ts` | `user` | any signed-in user |
| `getMyAccountFn` | `account.ts` | `user` | any signed-in user, own password flag and deletion blockers only; agency admins need local MFA |
| `listMySessionsFn` | `account.ts` | `user` | any signed-in user, own live sessions only, never tokens; agency admins need local MFA |
| `revokeMySessionFn` | `account.ts` | `user` | any signed-in user, own other sessions only (current session refused, NotFound for others); agency admins need local MFA |
| `revokeMyOtherSessionsFn` | `account.ts` | `user` | any signed-in user, own other sessions only; agency admins need local MFA |
| `updateMyNameFn` | `account.ts` | `user` | any signed-in user, own name only; agency admins need local MFA |
| `deleteMyAccountFn` | `account.ts` | `user` | any signed-in user, own account only, after re-verifying the password or a second factor; agency admins need local MFA |
| `getAuthMethodsFn` | `auth-methods.ts` | `public` | anyone |
| `getSetupStatusFn` | `setup.ts` | `public` | anyone |
| `completeSetupFn` | `setup.ts` | `public` | anyone |
| `getMeFn` | `me.ts` | `public` | anyone |
| `getInvitationFn` | `me.ts` | `public` | anyone |
| `acceptInvitationFn` | `me.ts` | `user` | any signed-in user |
| `getSitesOverviewFn` | `overview.ts` | `user` | any signed-in user |
| `getHomeActivityFn` | `home.ts` | `user` | any signed-in user |
| `listMcpKeysFn` | `mcp-keys.ts` | `org-editor` | any site member; editors see only their own keys, owners and agency admins all keys on the site |
| `createMcpKeyFn` | `mcp-keys.ts` | `org-editor` | any site member (MFA for agency admins); agency admins also need a fresh session (`REAUTH_REQUIRED`); editors cannot allow go-live |
| `revokeMcpKeyFn` | `mcp-keys.ts` | `org-editor` | editors revoke their own keys; owners and agency admins any key on the site; other keys are NotFound |
| `listAgencyMcpKeysFn` | `mcp-keys.ts` | `agency` | agency admin (MFA); the caller's own agency keys (no site); other roles are refused |
| `createAgencyMcpKeyFn` | `mcp-keys.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up); agency keys never allow go-live |
| `revokeAgencyMcpKeyFn` | `mcp-keys.ts` | `agency` | agency admin revokes their own agency key; another admin's key is NotFound |
| `getOAuthConsentFn` | `mcp-oauth.ts` | `public` (reason-based) | signed-out, invalid or tampered requests and non-members get a reason instead of data; nothing is changed |
| `approveOAuthConsentFn` | `mcp-oauth.ts` | `org-editor` | site access first (NotFound for other tenants); agency admins need a fresh second factor; editors cannot allow go-live; the signed query must name this site |
| `denyOAuthConsentFn` | `mcp-oauth.ts` | `user` | any signed-in user may refuse a request addressed to them; the query must be signed by the server |
| `listMcpConnectionsFn` | `mcp-oauth.ts` | `org-editor` | editors see only their own connected apps; owners and agency admins all on the site |
| `revokeMcpConnectionFn` | `mcp-oauth.ts` | `org-editor` | editors disconnect their own apps; owners and agency admins any app on the site; others are NotFound |
| `listAgencyMcpConnectionsFn` | `mcp-oauth.ts` | `agency` | agency admin (MFA); the caller's own agency apps (no site); other roles are refused |
| `approveAgencyOAuthConsentFn` | `mcp-oauth.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) approves the agency connector for an app; the signed query must name the agency resource; never allows go-live |
| `revokeAgencyMcpConnectionFn` | `mcp-oauth.ts` | `agency` | agency admin revokes their own agency app; another admin's app is NotFound |
| `getMyNotificationsFn` | `notifications.ts` | `user` | the caller's own notification choices and org memberships |
| `setMyNotificationFn` | `notifications.ts` | `org-editor` | members change their own choice (agency admins for the agency scope); locked events refuse; a non-member admin gets a readable refusal |
| `getOrgNotificationRulesFn` | `notifications.ts` | `org-owner` | org owner, agency admin (MFA) |
| `setOrgNotificationRuleFn` | `notifications.ts` | `org-owner` | org owner, agency admin (MFA); agency-locked cells refuse changes |
| `getAgencyNotificationRulesFn` | `notifications.ts` | `agency` | agency admin (MFA) |
| `setAgencyNotificationRuleFn` | `notifications.ts` | `agency` | agency admin (MFA); defaults and locks for clients and agency alerts |
| `getUnsubscribeFn` | `notifications.ts` | `public` | reads a signed unsubscribe link; reveals only its status and event label |
| `confirmUnsubscribeFn` | `notifications.ts` | `public` | the signed link is the authorization; a locked, expired or invalid link changes nothing |

Per-row exceptions (see `note`/`override` in the matrix): `verifyStepUpFn` needs a
two-factor session (everyone else gets Forbidden; wrong codes are refused);
`completeSetupFn` is open but refuses any caller without the setup token;
`getMeFn`, `getSitesOverviewFn`, `getHomeActivityFn` return only the caller's own
tenant data (asserted in the cross-tenant tests); client activity excludes every
`audit_log` row flagged `agency_only` (dev envs and `dev_env.*`, see
`dev-environments.md`); `getInvitationFn` and
`acceptInvitationFn` are authorized by an unguessable, unexpired, unaccepted
token (+ matching e-mail for accept).
`listAgencyMcpKeysFn`, `createAgencyMcpKeyFn` and `revokeAgencyMcpKeyFn` are agency-only: an agency key has no site, and another admin's key answers NotFound.
`listMcpKeysFn`, `createMcpKeyFn` and `revokeMcpKeyFn` answer NotFound for sites
outside the caller's organization. Revoking a key that belongs to someone else
answers NotFound for editors (the matrix override), so existence is not revealed.

## HTTP routes (`src/routes/api/**`)

| Route | Method | Credential | Expected |
| --- | --- | --- | --- |
| `/api/assets/upload` | POST | session | 401 anon; 403 other-org member; 403 `MFA_REQUIRED` admin without 2FA; editor/owner of target org and admins pass |
| `/api/admin/branding/upload` | POST | session | 401 anon; 403 editor/owner; 403 `MFA_REQUIRED`; admin passes |
| `/api/assets/file/$prefix/$filename` | GET, OPTIONS | none | public by design (see audit 8.3 on public assets) |
| `/api/auth/$` | GET, POST | Better Auth | delegated to Better Auth |
| `/api/health`, `/api/health/ready` | GET | none | public |
| `/api/metrics` | GET | `METRICS_TOKEN` bearer | 404 when unset; 401 wrong/missing |
| `/api/notifications/unsubscribe` | POST | signed unsubscribe token in the query | RFC 8058 one-click: 200 `{ ok }`, 400 for invalid, expired or locked links; no GET |
| `/api/sites/manifest` | GET | site **build** token | 401 for none/garbage/schema token; only own site's schema |
| `/api/sites/manifest` | POST | site **schema** token | 401 for build token; writes only the token's own site |
| `/api/sites/snapshot/current` | GET | site build token | 401 for schema token; only own publication. A dev env's token builds the snapshot from its ready content (`publicationId: null`); a `publicationId` query returns 400 for it |
| `/api/sites/preview` | GET | HMAC preview token | 401 expired/tampered/foreign-secret/unknown site; 404 for another site's slug |
| `/api/agency/mcp` | POST, GET, DELETE | OAuth access token issued for the agency resource (`${APP_URL}/api/agency/mcp`), or a personal agency key (`scope = agency`); agency admin with MFA. Anyone else who presents a valid credential gets `404 {"error":"Site not found"}`; no credential or an invalid one gets 401 with `WWW-Authenticate` naming the agency metadata; a site key here gets 401; an agency key on a site connector gets 401; 403 `mfa_required` for an agency admin without 2FA; 429 shared with the per-site connectors |
| `/.well-known/oauth-protected-resource/api/agency/mcp` | GET | none | public PRM for the agency resource (`resource_name` "Areca agency", `Cache-Control: no-store`); names no client or site |
| `/api/mcp/<siteSlug>` | POST, GET, DELETE | OAuth access token issued for that site (RFC 8707 audience), or a personal key for that site; 401 with `WWW-Authenticate: Bearer resource_metadata=…` for none, invalid, expired, revoked, other-site or disconnected credentials; 403 `insufficient_scope` without the `mcp` scope; 403 `mfa_required` as for keys; 404 for an unknown slug |
| `/.well-known/oauth-authorization-server/api/auth`, `/.well-known/openid-configuration/api/auth` | GET | none | public metadata, CORS `*`; the issuer matches the plugin's; root-level documents are not served |
| `/.well-known/oauth-protected-resource/api/mcp/<siteSlug>` | GET | none | public PRM for that site, `resource` equal to the connector URL; 404 for unknown slugs |
| `/api/auth/oauth2/authorize`, `/api/auth/oauth2/consent`, `/api/auth/oauth2/continue` | GET, POST | session cookie (for consent and continue) and the signed `oauth_query` | plugin endpoints; the consent endpoint does not check site membership itself. A grant is usable only with an `mcp_connection` row, which only `approveOAuthConsentFn` creates after the membership and step-up checks, so a consent without one yields a token that the MCP endpoint refuses (`401`). |
| `/api/auth/oauth2/register` | POST | none (open DCR) | rate limited: 20 an hour per address, 300 an hour deployment-wide |
| `/api/auth/oauth2/token` | POST | client | rate limited: 60 a minute per client and address; other `/api/auth/*` routes stay exempt from the app limiter |
| `/api/mcp` | POST, GET, DELETE | personal AI key (`Authorization: Bearer areca_mcp_…`); no cookies 401 for no, malformed, unknown, revoked or expired key, and for a user who is no longer a member; 403 `mfa_required` for an agency admin without 2FA when `ADMIN_MFA_REQUIRED` is set (default on); 429 after 120 requests a minute per key, or 600 a minute per client IP when the IP is known; tool access as listed under MCP tools |

## MCP tools (`src/server/mcp/tools/*.ts`)

The AI endpoint's tools are not rows in `authz-matrix.ts`. Each tool declares
its `access` level, `ToolRegistry` (`tool-kit.ts`) registers only the tools the
caller may use, and `requireAccess` (`guard.ts`) refuses a direct call with a
message that says who may do it. The access is re-read from the live role on
every request (`resolveMcpActor`, `keys.ts`). `mcp.test.ts` covers the role
listings, direct calls, cross-site ids, go-live and the agency schema tools.

| Access | Who may call it | Tools |
| --- | --- | --- |
| everyone | any site member (editor, owner, agency admin) | `get_site_info`, `get_collection_schema`, `list_entries`, `get_entry`, `create_entry`, `update_entry`, `list_revisions`, `get_preview_url`, `list_assets`, `get_asset`, `upload_asset_from_url`, `update_asset_alt`, `get_release_status`, `list_publications`, `get_build_job`, `get_global`, `update_global`, `discard_global_draft` |
| owner | owner or agency admin | `mark_ready`, `unpublish_entry`, `archive_entry`, `cancel_schedule`, `delete_entry`, `restore_revision`, `delete_asset` |
| go-live | a key with `allowGoLive` (the key flag and a non-editor live role) | `go_live`, `rollback`, `cancel_build`, `schedule_entry` |
| agency | agency admin only | `upsert_collection`, `delete_collection`, `upsert_global`, `delete_global`, `set_site_languages`, `set_publishing_mode`, `create_dev_environment` (production connector), `refresh_from_production`, `push_to_production`, `copy_entry_to_production` (development connector) |

Tools are also listed by the site's environment (`environments` in the tool spec). On a development connector the publishing and schedule tools (`get_release_status`, `list_publications`, `get_build_job`, `go_live`, `rollback`, `cancel_build`, `schedule_entry`, `cancel_schedule`) are not listed, and `create_dev_environment` is listed only on a production connector. A development connector is NotFound to every role except agency admins, on both the key and the OAuth endpoints (`handleSiteMcpRequest` and `runMcp`, `http.ts`; the 401 and discovery trade-off is in `dev-environments.md`). `push_to_production` with `goLive` needs the same go-live permission as `go_live`, and is refused before anything is written. The dev-env MCP tests are in `mcp/dev-env-tools.db.test.ts`.

Site content (globals) is reached by key through `get_global`, `update_global` and `discard_global_draft`. The section's entry id then works with the owner and go-live tools above. Editors and owners do not see disabled sections; a disabled section answers "not found" for them, as in the CMS. `update_global` refuses `seo` on a section without SEO, and `upsert_global` refuses `slug` fields and the reserved key `globals`.

### Agency connector (`/api/agency/mcp`)

The agency connector lists every per-site tool, from the same definitions (`tool-catalog.ts`), with a required `site` argument. Its tool access is the `agency` role's, and go-live tools need no flag there (`siteActorFor` sets `allowGoLive: true`). Each call resolves `site` through `resolveAgencySite`, which calls `assertAgencySiteReachable`; a site the caller cannot reach answers the same "not found" as a missing one. A test enforces that agency calls resolve their site only through that function. Navigation tools (`list_clients`, `list_sites`, `find_site`) read only the reachable sites. Every agency call is audited with `via: 'mcp-agency'` and the credential type. Tests: `server/mcp/agency-mcp.db.test.ts`, `server/mcp/agency-oauth.db.test.ts`, `server/mcp/agency-parity.test.ts`, `server/security/authz-routes.test.ts`.

Ids sent by an AI are checked against the key's site (`scope.ts`). An entry,
build job or publication on another site answers the same "not found" as a
missing id. Asset ids are looked up within the key's organization.

## Error shape

Server functions run behind `sanitizeErrorsMiddleware` (`src/start.ts`): typed
`AppError`s, `Response`s, redirects and `MFA_REQUIRED`/`REAUTH_REQUIRED`
pass through; everything else becomes `Something went wrong (ref: <id>)`.
Covered in `authz-matrix.test.ts` ("error shape that reaches the client").

## Object-id rows: no existence oracle

Rows addressed by a site, entry, asset, build job or invitation id (everything
in `content.ts`, `publishing.ts`, `updateAssetFn`/`deleteAssetFn`,
`revokeInvitationFn`/`resendInvitationFn`) authenticate first, then answer the
**same NotFound** for a missing id and for an id in another tenant
(`requireOrgMemberOrNotFound` in `session.server.ts`; messages are identical).
`getAssetFn` answers `null` in both cases. A member whose role is too low
(editor on an owner action) still gets 403: they already know the object
exists. In the matrix these rows are `hidden: true`, so ownerY expects
`not-found` instead of `forbidden`. Calls addressed by an organization id
(`listAssetsFn`, member/invitation/audit functions) answer 403 for non-members,
identically for existing and missing organizations.

Development environments (see `dev-environments.md`): the MCP connector of a dev
site answers the same 404 as a missing slug to every caller who is not an agency
admin (`handleSiteMcpRequest`, `server/mcp/http.ts`). Unauthenticated requests
still get the 401 challenge, so a `-dev` slug's existence is visible to them. Its
discovery document is generic (`resource_name` "Areca site", `no-store`). Asset
`originSiteId` is returned only to agency admins (`listAssetsFn`, `getAssetFn`,
`updateAssetFn`). `generateEntrySeoFn` checks membership before the language list.
Tests: `server/mcp/dev-env-connector.db.test.ts`, `server/security/visibility-probes.db.test.ts`,
`server/security/dev-env-audit-rename.db.test.ts`.

## Notes

- Org owners cannot change their own collection schema (agency-only), by design.
- Site content (globals) reuses the entry functions for ready, schedule, cancel schedule, history and restore, called with the section's entry id (`publishEntryFn`, `scheduleEntryFn`, `cancelScheduleFn`, `listRevisionsFn`, `restoreRevisionFn`). `unpublishEntryFn`, `archiveEntryFn` and `deleteEntryFn` refuse section entries. The entry id of a disabled section answers "not found" to editors and owners, in these functions and in the MCP entry tools, as the section does by key.
- `deleteSiteFn` is a step-up action like deleting an organization (the UI
  runs it through `useStepUp().run`).
- Only six rows still tolerate a non-authorization failure for allowed callers:
  the three Dokploy credential calls (outbound network), `verifyStepUpFn` (wrong
  code) and `getInvitationFn`/`acceptInvitationFn` (probe with an unknown token).
