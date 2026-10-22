# Troubleshooting

Start with the failing step: sign-in, writing content, preview, content pull, or deployment. Keep the exact error and the release/job ID when asking an agency admin for help. Do not include passwords, bearer tokens, preview URLs with tokens, recovery codes, or provider keys.

## Sign-in and access

| Problem | Check |
| --- | --- |
| `/setup` redirects to login | The instance already has a user. Sign in with an existing account; do not reset the database to solve a login problem. |
| Setup needs a token | Read the first-run token from the CMS terminal, or use the configured `SETUP_TOKEN`. See [onboarding](ONBOARDING.md). |
| Sign-in says `Invalid origin` | Open the canonical CMS origin and make sure `BETTER_AUTH_URL` and `APP_URL` match the intended origins. Restart after environment changes. |
| Sign-in requests an authenticator code | Enter the current code from the account's authenticator. A saved recovery code can be used through **Use a backup code**. Agency admins require MFA by default. |
| Access is restricted after admin sign-in | Complete two-factor enrollment or the requested verification in Account. Do not disable MFA on a shared instance. |
| Invitation email is missing | Check the address and pending invitation. Locally, open Mailpit at `http://localhost:8025`; check SMTP connectivity for deployed instances. |
| Invitation cannot be accepted | Check expiry, revocation, and whether the signed-in email matches the invited email. Ask an owner to resend it. |
| People, Settings, or publishing actions unavailable | Check your role. Editors author drafts; owners publish and manage client members; only agency admins manage Settings. See [permissions](AUTHZ_MATRIX.md). |

## Writing and releasing content

| Problem | Check |
| --- | --- |
| New entry says it is not saved yet | Add a title or valid slug and wait for the save indicator. Slugs must be unique in the collection. |
| A field prevents approval | Fill required fields and fix the indicated value. Optional fields still need valid values when filled. |
| Changes do not appear on the public website | Save the draft, mark the new version ready, then complete a successful Go live. Later draft edits are not automatically approved. |
| Scheduled edits differ from the draft | Scheduling freezes an approved version. Later draft changes do not replace it automatically; review and update the schedule explicitly. |
| Go live reports invalid references | Ensure referenced entries are approved and included in the same snapshot. Disabled or archived target entries cannot provide a public reference. |
| Two entries use the same URL | Collection routes and slugs must produce unique website paths. Fix the route or approved slug and mark affected entries ready again. |
| Media cannot be deleted | Drafts, approved/scheduled versions, revisions, or retained snapshots still reference it. Follow [asset retention](ASSET_RETENTION.md). |
| Draft seems lost after an interrupted save | Reopen the same entry in the same browser and review any draft-recovery offer. Compare revision history before restoring. |

## SDK and preview

| Problem | Check |
| --- | --- |
| CLI cannot find environment settings | Run from the website project root. The CLI loads that directory's `.env.local` and `.env`; existing process values take precedence. |
| Manifest push fails authentication | It needs `ARECA_SCHEMA_TOKEN`. The read-only `ARECA_SITE_TOKEN` cannot publish schema changes. |
| Content pull fails authentication | Update `ARECA_SITE_TOKEN` after rotation in the site settings. Keep schema and read credentials separate. |
| No publication exists | A ready entry alone is not enough. Request Go live and let the publication workflow finish; then pull again. |
| TypeScript config cannot be imported | Use the Node version recommended in [SDK setup](SDK.md), or the CLI's suggested `tsx` import path. |
| Generated content file is missing | Run `areca pull` before reading it and confirm the collection key/output directory. |
| Preview returns 404 or fails to connect | Implement the website preview route and ensure the site's production URL points to that running website. Locally start the demo on port 3001. |
| Preview token is invalid or expired | Reopen Preview from the saved CMS entry to obtain a new link. Check that the route forwards the complete opaque token. |
| Rich text renderer fails | Align the site's TanStack Markdown dependency with the SDK's document format. See [SDK rendering](SDK.md). |
| SEO changes are missing | Confirm the website uses SDK SEO helpers, the metadata was marked ready, and a new release was pulled and built. Older snapshots may have no `seo` property. |
| Images point to the wrong host | Check CMS `APP_URL`, then create a new release and pull again. Existing immutable snapshots retain their original URLs. |

## Deployment and infrastructure

Open the failed release in the Go-live panel and read **View log**. The website's provider/build log may contain additional detail that the CMS does not have.

| Problem | Check |
| --- | --- |
| `Dokploy credentials are not configured` | Configure the client connection and the site's target, or use the site's deliberate Demo workflow. Production publishing needs a target. |
| Content pull works locally but not in Dokploy | `localhost` inside a build container points to that container. Use a reachable CMS URL, configure the site token for build time, and allow network access. |
| Deployment succeeds but health check fails | The website health endpoint must report `ok: true` and the expected publication ID. Check hostname, TLS, route, and whether the deployed build pulled the pinned snapshot. |
| A publication stays queued | Check `WORKER_ENABLED`, worker logs, database connectivity, queue age, and whether an active or uncertain job blocks the same site. |
| Dispatch outcome is uncertain | Check the upstream deployment first. Follow [integration recovery](INTEGRATIONS.md); do not repeatedly redeploy or manually delete job rows. |
| CMS readiness returns 503 | Inspect `/api/health/ready` and [operations](OPERATIONS.md). Database/storage failure, excessive queue age, or stale worker state can fail readiness. |
| Redis unavailable | Rate limits count in memory on each instance (same budgets, not shared across instances) and a warning is logged; restore Redis and check health diagnostics. |
| Saved provider key cannot be decrypted | Restore the original encryption key matching the database, or replace the provider credential. Retain stable keys with backups. |

## AI SEO assistance

If **Generate with AI** is missing or unavailable, ask an agency admin to check Agency › AI and the CMS's `AI_SETTINGS_ENCRYPTION_KEY`. Check provider model access and credits if a request fails. A per-user hourly limit also applies. Generated suggestions need review and approval just like manual edits.

For operational incidents, use [operations](OPERATIONS.md), [recovery](RECOVERY.md), and [upgrades](UPGRADES.md). For website integration problems, use [SDK](SDK.md) and [API](API.md).
