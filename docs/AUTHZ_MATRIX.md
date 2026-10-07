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
| `rotateSiteTokenFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
| `deleteSiteFn` | `admin.ts` | `agency-fresh` | agency admin (MFA) with fresh session (step-up) |
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
| `listCollectionsFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `listEntriesFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `getEntryFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `createEntryFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `updateDraftFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `publishEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `unpublishEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `archiveEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `cancelScheduleFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `scheduleEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `deleteEntryFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `listRevisionsFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `restoreRevisionFn` | `content.ts` | `org-owner` | org owner, agency admin (MFA) |
| `getPreviewUrlFn` | `content.ts` | `org-editor` | org editor, org owner, agency admin (MFA) |
| `upsertCollectionFn` | `content.ts` | `agency` | agency admin (MFA) |
| `deleteCollectionFn` | `content.ts` | `agency` | agency admin (MFA) |
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
| `verifyStepUpFn` | `security.ts` | `user` | any signed-in user |
| `getAuthMethodsFn` | `auth-methods.ts` | `public` | anyone |
| `getSetupStatusFn` | `setup.ts` | `public` | anyone |
| `completeSetupFn` | `setup.ts` | `public` | anyone |
| `getMeFn` | `me.ts` | `public` | anyone |
| `getInvitationFn` | `me.ts` | `public` | anyone |
| `acceptInvitationFn` | `me.ts` | `user` | any signed-in user |
| `getSitesOverviewFn` | `overview.ts` | `user` | any signed-in user |
| `getHomeActivityFn` | `home.ts` | `user` | any signed-in user |

Per-row exceptions (see `note`/`override` in the matrix): `verifyStepUpFn` needs a
two-factor session (everyone else gets Forbidden; wrong codes are refused);
`completeSetupFn` is open but refuses any caller without the setup token;
`getMeFn`, `getSitesOverviewFn`, `getHomeActivityFn` return only the caller's own
tenant data (asserted in the cross-tenant tests); `getInvitationFn` and
`acceptInvitationFn` are authorized by an unguessable, unexpired, unaccepted
token (+ matching e-mail for accept).

## HTTP routes (`src/routes/api/**`)

| Route | Method | Credential | Expected |
| --- | --- | --- | --- |
| `/api/assets/upload` | POST | session | 401 anon; 403 other-org member; 403 `MFA_REQUIRED` admin without 2FA; editor/owner of target org and admins pass |
| `/api/admin/branding/upload` | POST | session | 401 anon; 403 editor/owner; 403 `MFA_REQUIRED`; admin passes |
| `/api/assets/file/$prefix/$filename` | GET, OPTIONS | none | public by design (see audit 8.3 on public assets) |
| `/api/auth/$` | GET, POST | Better Auth | delegated to Better Auth |
| `/api/health`, `/api/health/ready` | GET | none | public |
| `/api/metrics` | GET | `METRICS_TOKEN` bearer | 404 when unset; 401 wrong/missing |
| `/api/sites/manifest` | GET | site **build** token | 401 for none/garbage/schema token; only own site's schema |
| `/api/sites/manifest` | POST | site **schema** token | 401 for build token; writes only the token's own site |
| `/api/sites/snapshot/current` | GET | site build token | 401 for schema token; only own publication |
| `/api/sites/preview` | GET | HMAC preview token | 401 expired/tampered/foreign-secret/unknown site; 404 for another site's slug |

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

## Notes

- Org owners cannot change their own collection schema (agency-only), by design.
- `deleteSiteFn` is a step-up action like deleting an organization (the UI
  runs it through `useStepUp().run`).
- Only six rows still tolerate a non-authorization failure for allowed callers:
  the three Dokploy credential calls (outbound network), `verifyStepUpFn` (wrong
  code) and `getInvitationFn`/`acceptInvitationFn` (probe with an unknown token).
