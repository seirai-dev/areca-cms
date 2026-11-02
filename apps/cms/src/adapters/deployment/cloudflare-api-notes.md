# Cloudflare API notes

Verified against a live test account on 2 Nov 2026 with a user API token. Raw
captures were sanitized before they were written here: account IDs, script tags,
repo IDs and subdomains are placeholders (`<account-id>`, `<hex32>`,
`<account-subdomain>`).

## Verified live: Workers Builds

Every shape below came back from the live API.

- Base `https://api.cloudflare.com/client/v4`, `Authorization: Bearer <user token>`.
  Every response is an envelope `{ success, errors, messages, result, result_info? }`.
  Note that `errors` and `messages` can be `null` on success (domains list), so only
  `success` and `result` are relied on.
- `GET /accounts/<account-id>/workers/scripts` returns `result[]` with `id` (the
  script name) and `tag` (32 hex, the Worker's stable identity). The Worker
  `ceustermansferre-be` in the captures is the example below.
- `GET /accounts/<account-id>/builds/workers/<tag>/triggers` returns `result[]`:

  ```json
  {
    "trigger_uuid": "<uuid>",
    "external_script_id": "<hex32>",
    "trigger_name": "<hex32>",
    "build_command": "pnpm run build",
    "deploy_command": "npx wrangler deploy",
    "root_directory": "/",
    "branch_includes": ["main"],
    "branch_excludes": [],
    "deleted_on": null,
    "repo_connection": {
      "provider_type": "github",
      "repo_name": "<repo>",
      "provider_account_name": "<github-user>"
    }
  }
  ```

  The adapter uses `trigger_uuid` and `branch_includes`. A trigger with `deleted_on`
  set is no longer active; the site setup should not offer it.

- `POST /accounts/<account-id>/builds/triggers/<trigger_uuid>/builds` with the JSON
  body `{"branch":"main"}` returns the build right away:

  ```json
  {
    "build_uuid": "<uuid>",
    "status": "queued",
    "build_outcome": null,
    "initializing_on": null,
    "running_on": null,
    "stopped_on": null,
    "created_on": "2026-11-02T09:40:55.828Z",
    "trigger": { "trigger_uuid": "<uuid>", "branch_includes": ["main"] }
  }
  ```

  The create response has no `build_trigger_metadata`. Read the build back to get
  its source and branch.

- **No deduplication.** A second identical POST created a second build. The adapter
  sends this POST once and never retries it. After a lost or 5xx response it
  reconciles against the build list instead.
- `GET /accounts/<account-id>/builds/builds/<build_uuid>` returns the build.
  `status` goes `queued`, `initializing`, `running`, then `stopped`.
  `build_outcome` is `success`, `fail`, `skipped`, `cancelled`, `terminated`, or null
  until stopped. A real build took about 60 seconds.
- `build_trigger_metadata.build_trigger_source` is `manual` for builds created
  through the API and `push_event` for git pushes. `build_trigger_metadata.branch`
  is the branch that was built. The build also carries `trigger.trigger_uuid`.
- `GET /accounts/<account-id>/builds/workers/<tag>/builds?per_page=N` returns the
  same build objects, newest first, across every trigger on the Worker.
- `GET /accounts/<account-id>/builds/builds/<build_uuid>/logs` returns
  `result: { cursor, truncated, lines: [[epochMs, text], ...], events }`. Pass
  `?cursor=<cursor>` to get the next page while `truncated` is true. The adapter caps
  this at 50 pages. A 60-second build returned 280 lines in a single page.
- `PUT /accounts/<account-id>/builds/builds/<build_uuid>/cancel` returns the build
  with `build_outcome: "cancelled"`.
- `GET /accounts/<account-id>/workers/subdomain` returns `result.subdomain`, the
  account's workers.dev subdomain (`<account-subdomain>`).
- `GET /accounts/<account-id>/workers/scripts/<name>/subdomain` returns
  `{ enabled, previews_enabled }`. A Worker with the route disabled returns
  `enabled: false`.
- `GET /accounts/<account-id>/workers/domains?service=<name>` returns custom domains
  as `result[].hostname`. The list is empty when there are none.
- Token verification: `GET /user/tokens/verify` returns `result.status`
  (`active`, `disabled`, `expired`).
- `GET /accounts/<account-id>/workers/scripts` works with this token without the
  Account Settings Read permission.

## Docs only: Pages

The test account has no Pages projects, so these shapes come from the API reference
and have not been seen live. They are checked again by the first live Pages run.

- `POST /accounts/<account-id>/pages/projects/<name>/deployments` as
  `multipart/form-data` with the field `branch` and no `manifest`. This builds a
  git-connected branch. The request has no JSON body, so the adapter must not send a
  `content-type` header itself.
- Deployment object: `id`, `short_id`, `url`, `environment` (`production` or
  `preview`), `deployment_trigger` (`type`: `ad_hoc`, `github:push`, ...;
  `metadata.branch`, `metadata.commit_hash`), `latest_stage` (`name`: `queued`,
  `initialize`, `clone_repo`, `build`, `deploy`; `status`: `idle`, `active`,
  `success`, `failure`, `canceled`), `stages[]`, `created_on`.
- `GET .../deployments?env=production` lists deployments newest first.
- `GET .../deployments/<id>/history/logs` returns `result.data[] { ts, line }`.
- `GET /accounts/<account-id>/pages/projects/<name>` returns `subdomain`, `domains[]`,
  `production_branch`, and `source.config.production_branch`.

## Reconciliation rules the adapter relies on

- Workers: a build is ours only when its `trigger_uuid` is the target trigger,
  `build_trigger_source` is `manual`, its branch is the target branch, and
  `created_on` is at or after the dispatch time minus 5 seconds. Zero matches
  leaves the dispatch unknown; more than one is uncertain.
- Pages: `deployment_trigger.type` is `ad_hoc`, the branch matches, the environment
  is `production`, and `created_on` follows the same window.
- A manual build from the dashboard at the same time as our POST would look like ours.
  That case is uncertain (two matches) or, if it is the only one, accepted. Both are
  bounded by the same rule Dokploy uses.

## Permissions

The dashboard calls the CI permission **Workers Builds Configuration**. The API
reference calls the same group **Workers CI**. Setup copy uses the dashboard name.

## Build environment variables

The real sites use build variables `ARECA_CMS_URL` (the CMS origin) and
`ARECA_SITE_TOKEN` (a secret). Set them on the Worker's build settings, the same as for Dokploy.

## Build variables

Areca sets `ARECA_SNAPSHOT_ID` to the publication ID before every dispatch, so the
build's `areca pull` fetches that publication. Without it the build pulls the
previous live publication and the health check fails.

- `PATCH /accounts/<account-id>/builds/triggers/<trigger_uuid>/environment_variables`
  with the JSON body `{"ARECA_SNAPSHOT_ID":{"is_secret":false,"value":"<publication-id>"}}`.
  **Verified live on 2 Nov 2026: it merges.** Other variables, secrets included, are
  kept. The opt-in live test reads the variable back with `GET` on the same path and
  removes it with `DELETE` on `.../environment_variables/ARECA_SNAPSHOT_ID`; those two
  shapes are not yet confirmed by a recorded live run.
- `PATCH /accounts/<account-id>/pages/projects/<name>` with the JSON body
  `{"deployment_configs":{"production":{"env_vars":{"ARECA_SNAPSHOT_ID":{"type":"plain_text","value":"<publication-id>"}}}}}`.
  **Docs only:** there is no Pages project on the test account, so this has not been
  seen live. Per the docs, keys are updated one at a time and setting a key to `null`
  deletes it.

Both writes are idempotent, so the adapter retries them on transient failures (no
response, 429, 5xx). A refused write (4xx with an error envelope) means nothing was
dispatched. The deploy POST itself is never retried.
