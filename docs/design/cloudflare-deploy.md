# Cloudflare deployment adapter

Status: agreed with the product owner on 2 Nov 2026. Delivered as four stacked PRs (see Rollout). Each PR waits for review before the next starts.

## Problem

Areca deploys production sites only through Dokploy. Some client projects must run on Cloudflare (Pages or Workers). The agency wants the same flow as Dokploy: connect credentials for a client, then pick per site which provider and which project a go-live deploys to.

## Cloudflare API facts (read 2 Nov 2026)

Base URL `https://api.cloudflare.com/client/v4`. Auth `Authorization: Bearer <token>`. Every response is an envelope `{ success, errors[], messages[], result, result_info? }`.

| Purpose                      | Endpoint                                                                                                                                                                                | Permission            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Verify token                 | `GET /user/tokens/verify` → `result.status` = `active` \| `disabled` \| `expired`                                                                                                       | none                  |
| List Pages projects          | `GET /accounts/{account_id}/pages/projects?page=&per_page=`                                                                                                                             | Pages Read/Write      |
| Get Pages project            | `GET /accounts/{account_id}/pages/projects/{project_name}`                                                                                                                              | Pages Read/Write      |
| Create Pages deployment      | `POST /accounts/{account_id}/pages/projects/{project_name}/deployments` (multipart form, field `branch`; no `manifest` for git builds)                                                  | Pages Write           |
| Get / list Pages deployments | `GET …/deployments/{deployment_id}`, `GET …/deployments`                                                                                                                                | Pages Read/Write      |
| Pages deployment logs        | `GET …/deployments/{deployment_id}/history/logs`                                                                                                                                        | Pages Read/Write      |
| List Workers                 | `GET /accounts/{account_id}/workers/scripts` → `result[].id` (name), `result[].tag`                                                                                                     | Workers Scripts Read  |
| List Worker build triggers   | `GET /accounts/{account_id}/builds/workers/{script_tag}/triggers`                                                                                                                       | Workers CI Read/Write |
| Create build                 | `POST /accounts/{account_id}/builds/triggers/{trigger_uuid}/builds` JSON `{ branch }` → `result.build_uuid`, `status`                                                                   | Workers CI Write      |
| Get build                    | `GET /accounts/{account_id}/builds/builds/{build_uuid}` → `status` (`queued`/`initializing`/`running`/`stopped`), `build_outcome` (`success`/`fail`/`skipped`/`cancelled`/`terminated`) | Workers CI Read/Write |
| List builds for a Worker     | `GET /accounts/{account_id}/builds/workers/{script_tag}/builds`                                                                                                                         | Workers CI Read/Write |
| Build logs                   | `GET /accounts/{account_id}/builds/builds/{build_uuid}/logs`                                                                                                                            | Workers CI Read/Write |
| Set Pages build variable     | `PATCH /accounts/{account_id}/pages/projects/{project_name}` with `deployment_configs.production.env_vars`                                                                              | Pages Write           |
| Set Workers build variable   | `PATCH /accounts/{account_id}/builds/triggers/{trigger_uuid}/environment_variables` (merges, keeps secrets)                                                                             | Workers CI Write      |

- **The Workers Builds API requires a user-scoped token** (My Profile › API Tokens). Account-owned tokens do not work for it, so Areca uses a user token for both products.
- New tokens start with `cfut_`. The secret is shown once by Cloudflare.
- Pages projects whose `source` is not `github`/`gitlab` (direct upload) cannot be built from git, so they cannot be targets.
- Workers Builds rate limit: 10 builds/minute per Worker, 100/minute per account.
- Shapes not fully documented (trigger list fields, a git-only Pages deploy with just `branch`) are verified against a live test account in PR 2 and recorded in `apps/cms/src/adapters/deployment/cloudflare-api-notes.md`.

## Decisions

1. **Scope: per client, like Dokploy.** Credentials belong to an organization (client). The Cloudflare card sits next to the Dokploy card in the client's Deployment section (`ClientDeployment`). A client can have neither, one or both configured.
2. **Pages and Workers.** Pages projects connected to git, and Workers connected to Workers Builds, can be targets. Others are listed but disabled with a reason ("No git connection", "Workers Builds not connected").
3. **User token + Account ID.** The admin pastes a user token and the Account ID. There is no account picker.
4. **Verify** runs `GET /user/tokens/verify` (must be `active`) and then a per-permission check, each reported with its own pass/fail:
   - `pages`: list Pages projects.
   - `workersScripts`: list Workers.
   - `workersCi`: list triggers for the first Worker (passes as "not checked" when the account has no Workers).
     Save always verifies first; a failed token check refuses the save. Missing permissions are saved but reported.
5. **Storage.** New table `cloudflare_credential` keyed by `organization_id`: `account_id`, `encrypted_api_token`, `token_last4`, `last_verified_at`, `last_verify_result` (jsonb of the checks), `updated_by`, `created_at`, `updated_at`. The token is encrypted with `encryptSecret` under the new **optional** env var `CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY` (base64 32 bytes), context `cloudflare-credential:<organizationId>`. Without the env var the card says it must be set and Save is disabled. The token is never returned to the browser. The UI shows only "Connected", the Account ID, `…last4`, who saved it and when, and the last verify result.
6. **Actions.** Save and verify, Verify, Replace token, Remove. Save and Remove need step-up (`requireFreshAgencyAdmin`). Verify needs an agency admin. Replacing the Account ID without a new token reuses the stored token. Audit actions: `organization.cloudflare_credentials_{created,updated,verified,validation_failed,removed}`.
7. **Setup guide.** A "How to set this up" button on the Cloudflare card opens a slide-over with the steps: create a user token, the exact permissions (Account › Cloudflare Pages › Edit, Account › Workers Scripts › Read, Account › Workers Builds Configuration › Edit; the API reference calls this group "Workers CI"), scope it to one account, find the Account ID, connect the project to git (Pages) or Workers Builds (Workers), set the site's build env vars (same as Dokploy: `ARECA_URL`, site token, etc.), and set the health URL. The same content goes into `apps/docs` (`self-hosting/deployment-targets`).
8. **Site target shape.** `DeploymentTarget` becomes a union:
   ```ts
   | { provider: 'dokploy'; applicationId: string; healthCheckUrl: string }
   | { provider: 'cloudflare'; kind: 'pages'; projectName: string; branch: string; healthCheckUrl: string }
   | { provider: 'cloudflare'; kind: 'workers'; scriptName: string; scriptTag: string; triggerUuid: string; branch: string; healthCheckUrl: string }
   ```
   Existing rows (`provider: 'dokploy'`) stay valid. The connection URL for Cloudflare is `https://api.cloudflare.com/client/v4/accounts/<accountId>` and the deployment resource key is `sha256("<connectionUrl>\n<projectName|scriptTag>")`, the same shape as Dokploy.
9. **Branch.** The production branch is saved when the project is selected (Pages: `source.config.production_branch`; Workers: the trigger's branch). It is shown read-only. No override. Re-selecting the project refreshes it.
10. **Workers trigger.** The trigger covering the production branch is picked automatically. When more than one matches, a small "Build trigger" select appears.
11. **Site Deployment tab.** A segmented control **Dokploy | Cloudflare** at the top. A provider the client has not configured is disabled with a link to the client's Deployment settings. Switching clears the chosen target. Saving is blocked while a deployment is pending (existing check). Publishing mode and Stop deploying are unchanged.
12. **Combobox.** One searchable combobox (Popover + `command.tsx`) for both providers. Cloudflare groups: Pages and Workers; each row shows name, production branch and main domain; unbuildable rows are disabled with the reason. Dokploy moves to the same combobox and keeps its manual Application ID fallback. Cloudflare has no manual fallback.
13. **Health URL.** Required. Prefilled from the project's first custom domain, else `<subdomain>.pages.dev` / `<script>.<account-subdomain>.workers.dev` when known. Editable. Same publication-aware health check as Dokploy.
14. **Dispatch safety.** Same rules as Dokploy: never redispatch blindly. On a timeout or 5xx after sending:
    - Pages reconcile: list deployments; accept only a unique production deployment with `deployment_trigger.type = 'ad_hoc'` on the target branch created at or after `dispatchedAt`.
    - Workers reconcile: list builds for the Worker; accept only a unique build on the target trigger/branch with an API trigger source created at or after `dispatchedAt`.
    - Otherwise the job stays uncertain.
      Completion: Pages = the `deploy` stage of the deployment is `success` (done) or `failure`/`canceled` (error); Workers = `status: stopped` with `build_outcome: success` (done), anything else stopped (error).
      Status polls retry transient failures (network, 408, 429, 5xx) for about 30 seconds before the job is marked uncertain.
      Snapshot. Before the dispatch Areca writes the build variable `ARECA_SNAPSHOT_ID` = publication ID (Workers: trigger environment variables; Pages: production env_vars), like Dokploy's build argument. A failed write means not dispatched. The variable stays set after the release, so a later git-push build pulls the same publication.
15. **Logs.** The job log gets a link to the Cloudflare dashboard page for the deployment/build. On failure the last ~100 log lines are fetched and appended.
16. **Removing credentials.** Blocked only while a deployment is pending. The confirm dialog shows how many sites deploy with Cloudflare ("their next go-live will fail until you reconnect"). Sites keep their target. A go-live then fails with "Cloudflare credentials are not configured for this client".
17. **Copy** in en, nl and tr, including the guide.

## Rollout (stacked PRs)

1. **Credentials + guide + verify** (`feat/cloudflare-deploy-adapter` → `main`): schema + migration, env var, `cloudflare-credentials.ts` server module, Cloudflare API client (verify + list functions only), server fns, Cloudflare card in `ClientDeployment`, setup slide-over, copy. Tests: API client unit tests (mocked fetch), credential db tests (encryption, no token in DTO, step-up, removal guard), e2e of the card.
2. **Adapter + publish wiring**: `adapters/deployment/cloudflare.ts` implementing `DeploymentAdapter` (deploy, reconcile, waitForCompletion, logs), target union + schema, resource key, worker dispatch by provider, live verification + `cloudflare-api-notes.md`. Tests: adapter unit tests, worker db tests.
3. **Site Deployment tab UI**: provider switch, shared combobox, trigger select, health URL prefill, removal warning count. Tests: unit + e2e with a fake Cloudflare server.
4. **Docs site**: `deployment-targets.mdx` Cloudflare section + guide, site-settings/deployments pages.

Every PR: tests, e2e UI test, run the app and click through, screenshots, then PR.
