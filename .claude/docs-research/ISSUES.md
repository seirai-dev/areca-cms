# Consolidated open issues from the docs writers

Source: `.claude/docs-research/issues/w01.md` to `w11.md`. Writer IDs in brackets. Items are merged across writers and ordered by severity within each section. Items marked **CONFIRMED** were spot-checked against the code by the consolidator; all others are as reported by the writers and remain unverified.

Writer map: w01 start section, w02 editor pages, w03 going-live/library/account, w04 site settings and content model, w05 SDK guides, w06 SDK how-to, w07 SDK reference, w08 self-hosting overview/config/production, w09 self-hosting auth/storage/pipeline, w10 self-hosting capacity/assets/upgrades/recovery, w11 security.

---

## 1. Product bugs and inconsistencies in the CMS/SDK

### Security and data loss

**1. Export bundle writes the Dokploy encryption key in plain text [CONFIRMED]** [w10, w11]
- Summary: the organization export bundle stores `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` next to the credentials it protects.
- Evidence: `apps/cms/scripts/authoring-transfer.mjs:244` (`encryptionKey: process.env.DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`), `:249` (`JSON.stringify(bundle)`, file mode 0600 only).
- Docs now: `self-hosting/backup-and-recovery` and `docker/RECOVERY.md` say the bundle carries credentials "with their encryption key". `security/secrets` (w11) says the key is not in the bundle. The two docs disagree and the code matches neither the security claim.
- Fix: decide whether the bundle omits the key (the import error at line 255 already assumes the operator supplies it) or encrypts it under a separate passphrase. Correct `RECOVERY.md` and `security/secrets`.

**2. Assets used by any release cannot be deleted, so published files cannot be retracted [CONFIRMED]** [w08, w09, w10]
- Summary: `deleteAsset` refuses any asset still referenced by a publication, revision, draft or archive. No route in the code removes those references (w10 reports this; not exhaustively checked).
- Evidence: `apps/cms/src/server/assets/index.ts` `deleteAsset` (throws `AssetInUseError` when `retainedAssetUsage > 0`); `docs/DEPLOYMENT.md` "Media privacy" says deleting is "the only way" to stop a URL working; `docs/ASSET_RETENTION.md` says referenced assets cannot be deleted.
- Docs now: `self-hosting/asset-retention` and `self-hosting/storage-and-email` avoid the contradiction and describe only the conservative path.
- Fix: product decision (see Q4). Add a retraction path, or state plainly that released assets are permanent. Fix `DEPLOYMENT.md`.

**3. Library files are served without authentication [CONFIRMED]** [w08, w11]
- Summary: any Library file is reachable by URL with no session check. This conflicts with the brief's "private-by-default media".
- Evidence: `apps/cms/src/routes/api/assets/file/$prefix/$filename.ts` (GET calls `streamAssetFile` with no auth check); `apps/cms/src/server/assets/index.ts` `streamAssetFile` (around line 454) sends `Cache-Control: public, max-age=31536000, immutable` and `Access-Control-Allow-Origin: *`.
- Docs now: `security/index` and `cms/library` describe the public behaviour. `DEPLOYMENT.md` "Media privacy" is the source of the contrary claim.
- Fix: decide the policy (see Q5). If public, say so in the docs. Immutable one-year caching also makes item 2 harder, because cached copies cannot be purged.

**4. Placeholder secrets pass startup validation [CONFIRMED]** [w08]
- Summary: `BETTER_AUTH_SECRET` only needs to be non-empty, and an all-zero Dokploy key is accepted, so an unedited `.env` starts.
- Evidence: `apps/cms/src/env.ts:14` (`BETTER_AUTH_SECRET: z.string().min(1)`); `apps/cms/src/env.ts:64-66` (base64 regex only, which accepts `AAAA…=`); `docker/.env.example:7` (`replace-with-openssl-rand-hex-32`) and `:11` (all-zero key); `apps/cms/.env.example:3` (`BETTER_AUTH_SECRET=change-me`).
- Also reported by w08 (not checked): `apps/cms/.env.example` lists `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` under "Optional" and leaves it blank even though `env.ts` requires it, and has `DOKPLOY_ALLOW_INSECURE_HTTP=true` and `ALLOW_PRIVATE_HEALTH_CHECKS=true` uncommented.
- Fix: reject known placeholders and the all-zero key at startup. Fix both `.env.example` files.

**5. `docker/compose.yml` drops most operational settings and has unsafe defaults [CONFIRMED]** [w08, w09, w10]
- Summary: the CMS `environment` block passes none of `RATE_LIMIT_TRUST_PROXY`, `WORKER_ENABLED`, `WORKER_CONCURRENCY`, `LOG_LEVEL`, `ADMIN_MFA_REQUIRED`, `AUTH_EMAIL_PASSWORD_ENABLED`, the SSO/social sign-in variables, `DOKPLOY_ALLOW_INSECURE_HTTP`, or `NODE_OPTIONS`. Values set in `.env` have no effect.
- Evidence: `docker/compose.yml` cms `environment` block (checked). `S3_ACCESS_KEY` defaults to `areca-demo` (also used by `rustfs`). `CMS_IMAGE` defaults to `ghcr.io/ekozf/areca-cms:latest` (w10). The CMS port is bound to `127.0.0.1` only (w10), while `DEPLOYMENT.md` needs the Dokploy host to reach the CMS.
- Docs now: `self-hosting/production` and `self-hosting/configuration` tell operators to add the variables to a production copy.
- Fix: pass the variables through; make `S3_ACCESS_KEY` required like `S3_SECRET_KEY`; pin the default image tag; document the reverse-proxy binding for production.

**6. Rate limiting trusts the first `X-Forwarded-For` hop, fails open, and skips `/api/auth`** [w01, w08, w10, w11]
- Summary: with `RATE_LIMIT_TRUST_PROXY=true`, the client-supplied first XFF entry becomes the rate-limit key, so a client that can append to the header can spoof its address. Without the flag every client shares the `unknown` bucket. Redis outages fail open. `/api/auth` is exempt from the app limiter, so sign-in brute-force protection depends on Better Auth defaults (unconfirmed).
- Evidence: `apps/cms/src/server/http/rate-limit.ts` `getClientIp` (lines 40-55; the first-entry logic was read); `enforceRequestRateLimit` (exempts `/api/auth`); `apps/cms/src/server/http/rate-limit.server.ts` (fail-open on Redis).
- Fix: use the hop your proxy appends, or a configured trusted-hop count. Decide whether auth routes fail closed. Document both (see Q13).

**7. Production refuses no insecure dev flags [writer-reported]** [w08]
- Summary: `ALLOW_PRIVATE_HEALTH_CHECKS` and `DOKPLOY_ALLOW_INSECURE_HTTP` are not guarded by `NODE_ENV`, unlike `DOKPLOY_DEV_FALLBACK_ENABLED`. The docs say not to set them in production, but the server accepts them.
- Evidence: `apps/cms/src/server/admin/dokploy-credentials.ts:34-41, 233-245`.
- Fix: refuse these at startup when `NODE_ENV=production`.

**8. Preview secret cannot be rotated, and invitation tokens are stored in plain text** [w11]
- Summary: the per-site preview secret is stored unhashed with no rotation control. Invitation tokens are stored in plain text and shown to owners as copyable links.
- Evidence: `apps/cms/src/db/schema.ts` (`previewSecret`); `apps/cms/src/server/admin/sites.ts`; `apps/cms/src/server/admin/members.ts`; `apps/cms/src/server/fn/me.ts` `acceptInvitationFn`.
- Fix: hash both at rest. Add a rotation control for the preview secret (see Q23).

**9. Agency admins can disable their own two-factor in the UI** [w03, w11]
- Summary: "Turn off" is shown to agency admins and not blocked. Enforcement only happens on the next admin call.
- Evidence: `apps/cms/src/features/account/two-factor-section.tsx`; `apps/cms/src/lib/session.server.ts` `assertAdminMfa`.
- Fix: block the action for admins, or warn clearly and say the admin is signed out of admin actions.

**10. `updateSiteFn` is agency-only with no step-up, yet sets the production URL and deployment target** [w11]
- Evidence: `apps/cms/src/server/security/authz-matrix.ts:220`.
- Fix: confirm intent. Add step-up if these fields are sensitive.

**11. Email delivery has no SMTP timeout, no credentials and no confirmed STARTTLS** [w08, w09]
- Summary: the SMTP adapter sets `secure: false` with no auth, and sets no timeout. `INTEGRATIONS.md` section 3.3 says sending is "bounded by timeouts".
- Evidence: `apps/cms/src/adapters/email/index.ts:29-33`.
- Fix: set a timeout. Confirm and document STARTTLS behaviour.

**12. Assets cannot be cleaned up in the Docker stack** [w10]
- Summary: `cleanup-assets.mjs` is not in the Docker image (no reference found in `apps/cms/Dockerfile`), and Compose does not publish the S3 API.
- Evidence: `apps/cms/scripts/cleanup-assets.mjs`; `apps/cms/Dockerfile`; `docker/compose.yml`.
- Fix: add the script to the image, or document that cleanup is unsupported in the stock stack.

### Wrong or contradictory behaviour

**13. Settings copy says going live works without a deployment target; the code blocks it** [w01, w04, w09]
- Summary: `settings_deploy_off` ("Not deploying. Going live marks the release as live.") and `settings_stop_description` imply a site with no target can go live. The publish guard rejects Production sites without a target and health URL.
- Evidence: `apps/cms/messages/en.json:1119`; `apps/cms/src/server/publishing/publications.ts:157-165` (checked; guard present).
- Fix: change the copy to match the guard, or change the guard (see Q7).

**14. Health check URL is labelled "Optional" but is required for Production** [w04]
- Evidence: `apps/cms/src/features/site-settings/deployment-tab.tsx`; `settings_health_hint` in `en.json`; the guard in `publications.ts`.
- Fix: change the hint to "Required for Production".

**15. Deleting a site is described as permanent, but its authoring history is archived** [w04]
- Summary: the `settings_delete_description` string says the site and its entries are removed "for everyone" and files stay in the Library. It does not say "permanent" or "not undoable", which w04 reports from a different string that was not located.
- Evidence: `apps/cms/src/server/admin/sites.ts` `deleteSite`; `apps/cms/src/server/content/deletion-archive.ts`; `apps/cms/messages/en.json` `settings_delete_description`.
- Fix: decide whether operators can restore the archive (see Q8). Align the copy.

**16. A content type missing from the website project is turned off at the next manifest push, with no warning** [w04]
- Evidence: `apps/cms/src/server/content/collections.ts` `syncManifest`; `apps/cms/src/features/content-model/schema-editor-sheet.tsx`.
- Also: `docs/ADMIN_GUIDE.md` says disabled types are excluded from new snapshots; the UI says entries "won't go live". The docs use the UI wording.
- Fix: warn on create, or block it.

**17. Stale-job recovery documented as 30 minutes; code recovers at the 60-second lease expiry** [w09]
- Evidence: `apps/cms/src/server/publishing/worker.ts:52` (`STALE_JOB_MS`) and `:777-800`.
- Fix: correct the docs. The code is what the pipeline page should describe.

**18. Archived entries cannot be returned to draft in the editor** [w02]
- Summary: `archiveEntry` sets status to archived. `restoreRevision` does not change status. The top bar offers "Move back to draft" only for published entries.
- Evidence: `apps/cms/src/server/content/entries.ts` `archiveEntry` and `restoreRevision`; `apps/cms/src/features/editor/editor-screen.tsx` `canUnpublish` and `canArchive`.
- Unconfirmed: whether another unarchive path exists.
- Fix: add a restore-from-archive action, or document that archive is final.

**19. Demo Dockerfile runner has no `ARECA_CMS_URL` or `ARECA_SITE_TOKEN`, so preview fails inside the container** [w06]
- Evidence: `examples/demo-site/Dockerfile` runner stage; `docs/DEPLOYMENT.md`; `packages/site-sdk/src/client.ts` (throws "Missing ARECA_SITE_TOKEN").
- Fix: pass both, or document the requirement.

**20. Uncertain dispatch has no recovery steps; the permission for "Check deployment status" is unconfirmed** [w01, w10]
- Evidence: `apps/cms/messages/en.json` `golive_reconcile_deployment`, `golive_resolve_uncertain`; `docs/TROUBLESHOOTING.md`; `docs/INTEGRATIONS.md`.
- Fix: write the recovery steps and confirm the permission.

**21. Setup token printed on the first status check, not at container start** [w08]
- Evidence: `apps/cms/src/server/admin/setup.ts` `getSetupStatus`; `apps/cms/scripts/docker-entrypoint.mjs` (warm-up only calls `/api/health`).
- Fix: confirm this is intended. If not, print it at start.

**22. Setup and runtime settings with no effect or no validation** [w08, w09, w10]
- `LOG_LEVEL` is read from `process.env` in `apps/cms/src/server/log.ts:228`, not validated in `env.ts`, and an invalid value silently falls back to `info`. It is also missing from the env table in `docs/OPERATIONS.md`.
- `VITE_APP_TITLE` (`apps/cms/src/env.ts:115`) and `SERVER_URL` (`env.ts:12`, `.env.example:51`) are declared but read nowhere.
- No setting for the database pool size (`apps/cms/src/db/index.ts` passes no `max`). No env var or Compose setting documents the Node heap limit that `docs/CAPACITY.md` recommends.
- Env table in `docs/OPERATIONS.md` omits `ALLOW_PRIVATE_HEALTH_CHECKS`, `ADMIN_MFA_REQUIRED`, `WORKER_ENABLED`, `RATE_LIMIT_TRUST_PROXY`, `SETUP_TOKEN` and `DOKPLOY_ALLOW_INSECURE_HTTP` [w09].
- Fix: validate `LOG_LEVEL`; remove or wire up unused variables; add the missing rows.

**23. Rolled-back status is defined but never set** [w03]
- Evidence: `rolled_back` appears only in `apps/cms/src/server/ops/metrics.ts`. Not set in `apps/cms/src/server/publishing/publications.ts`.
- Fix: remove it, or wire it up and show it on the going-live page.

**24. Hard-coded English strings bypass `messages/en.json`** [w01, w04]
- `apps/cms/src/features/site-settings/deployment-tab.tsx`: "Publishing mode", "Mode", "Production", "Demo — no production deployment".
- `apps/cms/src/features/site-settings/developer-tab.tsx`: "Build token (read only)", "Schema-write token", "Rotate schema token", "Rotate schema token?" and its description.
- Fix: move to message keys.

**25. Site token is shown once in the UI but the older guide says it stays on the Sites tab** [w05]
- Evidence: `apps/cms/messages/en.json` `settings_token_reveal_body`; `docs/ADMIN_GUIDE.md`.
- Fix: confirm the current behaviour and update the doc.

**26. Library limit shown as "20 MB"; the server uses 20 MiB** [w03]
- Evidence: `apps/cms/src/server/assets/index.ts` (`20 * 1024 * 1024`).
- Fix: show "20 MiB" or round the limit.

**27. Schema check on Go live: editor message and blocking behaviour not checked** [w05]
- Evidence: `apps/cms/src/server/content/snapshot.ts:244` returns `ok: false`; the UI path was not traced.
- Fix: confirm whether the release is blocked and what the editor sees.

**28. Pull during an active build returns the build in progress, not the live publication** [w01]
- Evidence: `apps/cms/src/routes/api/sites/snapshot/current.ts`.
- Fix: document it (or change it).

**29. Schema-level contradictions in field types and the image picker** [w07]
- `reference` `collection` is optional in the manifest schema but refused on write (`apps/cms/src/routes/api/sites/manifest.ts`; `validateReferences` in `apps/cms/src/server/content/validation.ts`).
- `$slug` in a route pattern is hinted but not validated (`content_schema_route_hint` in `en.json`).
- The `image` picker may not list PDFs even though `ALLOWED_MIMES` includes `application/pdf` (`apps/cms/src/server/assets/index.ts`, `apps/cms/src/features/editor/fields/image-well.tsx`). Unconfirmed.
- Fix: validate or document each.

**30. Preview response headers in `docs/API.md` differ from the route** [w07]
- Docs say `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`. The route sends `no-store, private` and `noindex` (`apps/cms/src/routes/api/sites/preview.ts`).
- Fix: correct or retire `docs/API.md`.

**31. Migrations 0009, 0013, 0014 and 0015 have no release notes** [w10]
- Evidence: `apps/cms/drizzle/`; `docs/UPGRADES.md` lists only 0007, 0008, 0010, 0011, 0012, 0016.
- Fix: write the notes.

**32. `docs/UPGRADES.md` and `docs/OPERATIONS.md` allow extra replicas; `docs/CAPACITY.md` allows one** [w08, w10]
- Summary: a replica conflict. Pages recommend a single replica. See Q1.
- Fix: one supported statement.

---

## 2. Questions for the owner

**Q1. Are multiple replicas supported?** [w08, w10]
- Options: (a) single replica only, stated plainly; (b) extra replicas with `WORKER_ENABLED=false`, with in-memory state documented.
- Pages: `/docs/self-hosting/production`, `/docs/self-hosting/capacity`, `/docs/self-hosting/upgrades`, `/docs/self-hosting/operations`.

**Q2. What is the Node.js engine floor?** [w01, w05, w07]
- `packages/site-sdk/package.json` says `>=22.6.0`. Native TypeScript config import may need Node 22.18+ or 23.6+, and the page recommends Node 24 LTS or `tsx`.
- Options: keep 22.6 with the `tsx` fallback; raise the floor to 22.18 (or 23.6); require Node 24 LTS.
- Pages: `/docs/sdk/installation`, `/docs/sdk/cli`, `/docs/quickstart`.

**Q3. Is the SDK published on npm?** Not raised by a writer; raised by the owner's question. `packages/site-sdk/package.json` is named `@areca-cms/site-sdk` and has a `publishConfig` block.
- Options: publish to npm; keep it workspace-only and document git or tarball install.
- Pages: `/docs/sdk/installation`, `/docs/sdk`.

**Q4. Can a released asset be retracted?** [w08, w09, w10]
- Options: (a) released assets are permanent, documented as such; (b) a purge path that removes the asset from releases and returns 410 (needs a cache strategy); (c) allow deletion of referenced assets and invalidate releases.
- Pages: `/docs/self-hosting/asset-retention`, `/docs/self-hosting/storage-and-email`, `/docs/self-hosting/production`.

**Q5. Are Library files public or private by default?** [w08, w11]
- Options: public URLs (document it, accept item 3); private-by-default with auth or signed URLs for unreleased files.
- Pages: `/docs/cms/library`, `/docs/security`, `/docs/self-hosting/storage-and-email`.

**Q6. Should the export bundle contain the encryption key?** [w10, w11]
- Options: omit it and require the operator to supply the key on import; encrypt the bundle under a separate passphrase.
- Pages: `/docs/self-hosting/backup-and-recovery`, `/docs/security/secrets`.

**Q7. Can a site go live without a deployment target?** [w01, w04, w09]
- Options: block (current code, fix the copy); allow "live without deploy" for demo sites only; allow it for all sites.
- Pages: `/docs/cms/going-live`, `/docs/cms/deployments`, `/docs/self-hosting/deployment-targets`.

**Q8. Can operators restore a deleted site?** [w04]
- Options: keep the `deleted_content_archive` as a restore path and document it; say deletion is permanent and drop the archive.
- Pages: `/docs/cms/clients-and-sites`.

**Q9. Should clients and sites be archivable?** [w04]
- The brief asked for it. Nothing exists in the UI or server (only entries are archivable).
- Options: add it; drop it from the brief.
- Pages: `/docs/cms/clients-and-sites`.

**Q10. Should provider sign-in count as a fresh session for step-up?** [w11]
- Summary: GitHub, Google, Discord and Microsoft sessions satisfy the 10-minute step-up window without an authenticator code, and agency admins can run admin actions on a provider session.
- Options: keep; require TOTP for admin actions; shorten the window.
- Evidence: `apps/cms/src/server/security/step-up.ts` `assertFreshSession`; `apps/cms/src/lib/session.server.ts` `requireAgencyAdmin`.
- Pages: `/docs/security/two-factor-and-step-up`, `/docs/security/permissions-matrix`.

**Q11. Should admins be able to disable their own two-factor?** [w03, w11]
- Options: block it; allow with a clear warning.
- Pages: `/docs/security/two-factor-and-step-up`, `/docs/cms/account`.

**Q12. How does a locked-out user recover?** (password, two-factor, lost backup codes) [w03, w11]
- Summary: no UI or server path lets another admin reset a user's password or two-factor. The Account page has no name, email or password change, and no reset flow was found.
- Options: admin reset with step-up and audit; self-service only; document "contact the platform owner".
- Pages: `/docs/cms/account`, `/docs/security/two-factor-and-step-up`, `/docs/self-hosting/authentication`.

**Q13. Which proxy hop is trusted, and should rate limiting fail open or closed?** [w01, w08, w10, w11]
- Options: first XFF entry (current); last hop or a configured trusted-hop count. Fail open (current) or closed on auth routes.
- Pages: `/docs/self-hosting/configuration`, `/docs/security/rate-limits`, `/docs/self-hosting/troubleshooting`.

**Q14. Are plain-HTTP health checks allowed on public hosts?** [w06]
- Summary: health URLs must be HTTPS unless the private-network override is set. The Dokploy adapter has an `allowInsecureHttp` option. The rule is not confirmed.
- Pages: `/docs/sdk/go-live-builds`, `/docs/self-hosting/deployment-targets`.

**Q15. Can a localhost production URL be used for local preview?** [w06]
- Unconfirmed: whether the CMS accepts `http://localhost:3001` as a Production URL.
- Pages: `/docs/sdk/preview`, `/docs/sdk/example-site`.

**Q16. What happens after a scheduled release fails during build?** [w02]
- Options: retry on the next scheduler tick; back off first; stop and notify the editor.
- Pages: `/docs/cms/scheduling`.

**Q17. Can editors see History and un-archive entries?** [w02]
- Only restore is owner-gated in code. Read access for editors is unconfirmed.
- Pages: `/docs/cms/writing-entries`, `/docs/cms/history-and-activity`.

**Q18. Must a site have a Production URL before preview works?** [w02]
- Pages: `/docs/cms/preview`.

**Q19. Should there be a per-site or per-client AI off switch?** [w04, w11]
- Summary: today the only instance-wide switches are removing the key or unsetting `AI_SETTINGS_ENCRYPTION_KEY`. Whether "Generate with AI" is hidden or disabled for users without access is unsettled.
- Pages: `/docs/cms/ai-settings`, `/docs/cms/seo-and-ai`, `/docs/security/ai-data-handling`.

**Q20. Should PostgreSQL major-version upgrades be documented?** [w10]
- Options: write a dump-and-restore procedure; state it is unsupported.
- Pages: `/docs/self-hosting/upgrades`.

**Q21. Does Redis hold state that must survive a restore?** [w10]
- Summary: the RECOVERY runbook says Redis may be rebuilt if it is only a cache but the archive includes it "to preserve operational state".
- Pages: `/docs/self-hosting/backup-and-recovery`.

**Q22. Should the Docker stack ship an asset cleanup job?** [w10]
- Pages: `/docs/self-hosting/asset-retention`.

**Q23. Is a preview-secret rotation control needed?** [w11]
- Pages: `/docs/security/tokens`.

**Q24. Should Library images accept PDFs?** [w07]
- Pages: `/docs/sdk/field-types`.

**Q25. Should the database pool size and Node heap be configurable?** [w10]
- Pages: `/docs/self-hosting/capacity`.

---

## 3. Doc follow-ups

Add or correct these once the questions above are decided.

- Export and restore: correct the key wording in `/docs/self-hosting/backup-and-recovery` and `/docs/security/secrets` (after Q6). Add the restore commands for an isolated port, key decryption and lease recovery that `docker/RECOVERY.md` lacks. Add a restored-copy override example. (w10)
- Asset retention: write the retraction answer into `/docs/self-hosting/asset-retention` (after Q4). Remove the "only way" claim from `DEPLOYMENT.md`. (w08, w09, w10)
- Replicas: one statement in `/docs/self-hosting/production`, `/docs/self-hosting/capacity`, `/docs/self-hosting/upgrades` (after Q1). (w08, w10)
- Upgrades: release notes for migrations 0009, 0013, 0014, 0015. Add a PostgreSQL major-upgrade section if Q20 is yes. Add the HIGH_RISK retry and identifier-rename steps, which currently have no command. (w10)
- Compose and env: add the missing variables to the table in `/docs/self-hosting/configuration` and `docs/OPERATIONS.md`. Note that `LOG_LEVEL` is unvalidated. Remove `VITE_APP_TITLE` and `SERVER_URL` from docs or code. (w08, w09, w10)
- Install: state the Node floor and the TypeScript loading rule in `/docs/sdk/installation` and `/docs/sdk/cli` (after Q2). Pin the pnpm version in CI examples (`examples/demo-site/Dockerfile`, `/docs/sdk/schema-sync`). (w01, w05, w07)
- Health checks: document the HTTPS rule in `/docs/sdk/go-live-builds` (after Q14). Document the Demo Dockerfile env fix (item 19). (w06)
- Preview: state the Production URL requirement and the localhost rule in `/docs/cms/preview` and `/docs/sdk/preview` (after Q15, Q18). Correct the preview headers and retire `docs/API.md` (item 30). (w02, w06, w07)
- Scheduling: document the retry behaviour in `/docs/cms/scheduling` (after Q16). Correct the 30-minute stale-job figure in `/docs/self-hosting/publishing-pipeline` to the 60-second lease. (w02, w09)
- Going live and deployments: rephrase "Not deploying" copy in `/docs/cms/going-live` and `/docs/cms/deployments` after Q7. Note the rolled-back status only if item 23 is wired up. (w03, w04)
- Account and two-factor: document the chosen recovery path (Q12) and two-factor rules (Q11). Confirm whether new backup codes invalidate the old set. Confirm the sign-in two-factor rate limit in a running instance. (w03, w11)
- Security tokens: state invitation-token single-use and the preview-secret rotation control (Q23). (w11)
- Rate limits: correct `/docs/security/rate-limits` to match the `/api/auth` exemption. Document the proxy hop and the Redis fail-open behaviour (Q13). Confirm the AI limit `Retry-After` header and the server-function error shape. (w01, w11)
- Labels: use "changes ready" and "What's changing" in `/docs/cms/statuses-and-review` instead of "pending changes". Show the Library limit as 20 MiB in `/docs/cms/library`. (w02, w03)
- Site token: state when the token is shown and whether it can be seen again (item 25) in `/docs/sdk/installation`. (w05)
- Content types: use the UI wording in `/docs/cms/content-types`. Add the warning behaviour once item 16 is decided. (w04)
- Site deletion: align `/docs/cms/clients-and-sites` with Q8. (w04)
- Recovery of the AI key: `AI_SETTINGS_ENCRYPTION_KEY` must be listed on `/docs/self-hosting/configuration`. (w04)
- SDK reference: confirm the TanStack Router `head()` script shape in `/docs/sdk/seo`. Confirm the field-type value table in `/docs/sdk/reading-content` with tests. Confirm the `dokploy:setup` script behaviour in `/docs/self-hosting/deployment-targets`. (w05, w06, w09)
- Start pages: document the pull target during a build in `/docs/concepts`. Document the Redis rate-limit failure mode in `/docs/troubleshooting`. Document the demo release label in `/docs/glossary` once confirmed. Document the scheduler cadence in `/docs/concepts`. (w01)
- Setup token: document where the setup token appears (item 21) in `/docs/self-hosting/first-run`. (w08)
- Uncertain dispatch: write the recovery steps in `/docs/self-hosting/troubleshooting` once item 20 is decided. (w01, w10)
- Authentication: confirm the invitation-delivery status wording against the People screen strings in `/docs/self-hosting/authentication`. (w09)
- Secrets: confirm that Better Auth two-factor secrets are protected by `BETTER_AUTH_SECRET` (currently sourced from `DEPLOYMENT.md`, not checked). (w11)
- Security index: state the public behaviour of Library files (Q5) and the permissions-matrix entry for `updateSiteFn` (item 10). (w11)
- AI: document the behaviour when the saved key cannot be decrypted, once confirmed in a running instance (`/docs/security/ai-data-handling`). (w11)
