# Recovery and organization portability

The recovery unit is PostgreSQL + the entire S3 object store + configuration and encryption keys. Retain every revision/publication and its assets. The repository does not schedule backups for you: define an operator-owned backup cadence and retention period, back up before migrations, copy archives encrypted to a separate host, limit access, and regularly exercise restoration. The Compose backup command stops all services in the target project while it captures volumes, so plan for that outage. For managed services, coordinate database and object-store snapshots to one no-writes window. Archives and authoring bundles contain credentials, personal data and unpublished content: never commit them or place them in public storage.

## Coordinated full instance backup

Run from the repository root against the intended Compose project, using its original environment file:

```sh
node docker/recovery.mjs backup areca-demo docker/.env /secure/backups/areca-2026-10-01
```

The CLI stops **all** project services first, preventing database/object writes while capturing PostgreSQL, RustFS and Redis volumes. It preserves `.env` (including `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`, optional `AI_SETTINGS_ENCRYPTION_KEY`, auth secret, database and S3 credentials), original and fully resolved compose configuration, exact container image IDs and SHA-256 file checksums. The explicit environment file takes precedence over unrelated shell variables. Backup checks that existing database/storage/CMS container credentials match it, and aborts on mismatch without printing secret values. The archived resolved compose configuration contains literal environment values, so ambient variables cannot override restored credentials; `$` values are escaped for Compose. A failure leaves services stopped and the incomplete directory must not be used. On success, move/copy the archive off host then explicitly restart the original instance with its existing compose command. Retain/export the recorded images (`docker image save`) or pin available registry digests before relying on a different recovery host. Physical PostgreSQL/RustFS backups require the same engine images and platform. For managed services use provider-coordinated snapshots instead, maintaining the same no-writes window and preserved secrets.

## Isolated full restore

Choose a **new** project name and restore into empty volumes. The CLI refuses existing destination volumes and corrupted archives. It writes the pinned-image override alongside the destination environment file, leaving the source archive unchanged. Copy `instance.env` securely to the desired environment path without changing its key/password values. Keep all included encryption keys: the Dokploy key unlocks saved deployment credentials, and the optional AI settings key unlocks the stored OpenRouter key. If an encryption key is intentionally unavailable, restore the data but expect to re-enter the corresponding provider credential.

```sh
node docker/recovery.mjs restore areca-restore /secure/restore.env /secure/backups/areca-2026-10-01
```

Start only PostgreSQL, RustFS and Redis using `docker compose --project-name areca-restore --env-file /secure/restore.env -f /secure/backups/areca-2026-10-01/compose.yml -f /secure/areca-restore-images.yml up -d postgres rustfs redis`. Avoid host port collisions using an additional override. Verify counts of organizations, permissions, entries, revisions, publications and jobs, retrieve several assets and compare checksums, and decrypt a preserved deployment credential using the original encryption key. Keep external deployments blocked while testing. Inspect/recover interrupted build leases before enabling workers. Start CMS with an isolated URL/port after data verification; sign in, inspect an unpublished draft, revision and live snapshot, and serve an asset. Record the commands/results/date in the operator's restore log. Cut over only after these checks; keep the original backup unchanged and retain the previous instance until recovery is accepted. Redis may be rebuilt if only used as cache; the archive includes it to preserve the current operational state.

## Versioned organization authoring export/import

From `apps/cms`, with dependencies installed and all CMS/worker writes stopped:

```sh
ARECA_WRITES_STOPPED=1 node --env-file=.env.local scripts/authoring-transfer.mjs export ORGANIZATION_ID /secure/organization.json
ARECA_WRITES_STOPPED=1 node --env-file=.env.local scripts/authoring-transfer.mjs import --offline /secure/organization.json
```

Version 1 includes the organization, sites and manifests, collections, draft/approved/scheduled data, complete entry revisions, asset metadata **and bytes with SHA-256 checksums**, membership roles, invitations, publications, build jobs, audit history, retained deleted-content archives and encrypted deployment credentials with their encryption key. User references are captured by email; authentication accounts, passwords and other organizations are deliberately outside the organization boundary. Provision matching destination users first. Import maps historical actors and permissions to those users, rejects missing/ambiguous identities, validates bundle/version/database columns/organization relationships/asset integrity, and relies on database constraints to reject ID/slug conflicts. Use the exporter database schema version; migrate destination before importing.

Import creates a new organization preserving content IDs and references, forces imported sites into visibly labeled demo mode, removes deployment targets, rotates build/preview secrets and disables invitation tokens. Rotate new build and schema-write tokens in settings when reconnecting integrations. Credential imports require the preserved encryption key to match the isolated destination; use full instance restore to recover authentication and original integration tokens. Asset writes are compensated if the database transaction fails; cleanup failures identify keys to remove before retrying. Interrupted imports can leave orphaned objects: remove only the listed import keys in the isolated destination before retrying. Offline import prevents races with asset deletion and object puts. Re-export the destination and compare content/history/assets as the portability verification.

When importing into a different `APP_URL`, recognized asset URLs in entry authoring data and revisions are rebased to the destination. Historical publication snapshots remain verbatim for audit; their public URLs may still name the source site. Publish a new demo release before using imported content at the destination. External media URLs are preserved.

Imported publications become historical `superseded` records with rollback eligibility and deployment timestamps cleared; source deployment status/timestamps and job states are retained in `publication.import` audit events and the original bundle. Queued source jobs are cancelled during import. A destination must explicitly request a new demo or production release before any imported snapshot can be reported as deployed there.

## Retry deferred object cleanup

After a failed storage deletion or organization deletion, cleanup keys remain in `storage_object_deletion`. Retry against the intended instance from `apps/cms`:

```sh
node --env-file=.env.local scripts/cleanup-assets.mjs
```

The command processes up to 1,000 keys; repeat until no pending objects remain. Failed keys remain queued with their last error for the next run. Full instance backups preserve this queue with the database. Never run cleanup against an organization import destination while an offline import is in progress.
