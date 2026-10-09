# Recovery and portability

Choose the recovery path that matches what was lost. A database copy alone is
not a complete instance backup: Areca also needs uploaded S3 objects and the
encryption keys used for credentials stored in the database. The repository
does not schedule backups automatically. Keep protected copies off the CMS host
and rehearse restores before relying on them.

## Whole-instance recovery

For the repository's Docker Compose deployment, follow the detailed
[full-instance backup and isolated restore runbook](../docker/RECOVERY.md).
Its backup command stops the Compose project while capturing PostgreSQL, RustFS,
Redis, the environment file, and pinned image details; plan for that outage.
Restore into a new project and empty volumes, verify data and assets, and keep
the source archive unchanged until the recovered instance is accepted.

For managed PostgreSQL or object storage, use provider snapshots coordinated
within one no-writes window: stop all CMS/worker writers, capture both services
and the matching configuration/encryption keys, then restore them together.
Coordinate with the provider for service-specific snapshot and restore steps.

Before migrations, use a coordinated backup and keep the previous image
reference. [Upgrade and rollback](UPGRADES.md) explains the restore-first
rollback process; never point older code at a database already migrated by a
newer release.

## Move one organization

For a single client's authoring data, use the versioned organization
export/import workflow in the [detailed recovery runbook](../docker/RECOVERY.md#versioned-organization-authoring-exportimport).
It runs from `apps/cms` with the configured database and S3 access; it does not
require Docker. Stop CMS and worker writes, set `ARECA_WRITES_STOPPED=1`, and
follow the documented `authoring-transfer.mjs export` and offline import
commands. Import into an isolated destination first.

This portability bundle contains organization content and history, asset bytes,
memberships, invitations, audit history, and encrypted deployment credentials.
It does not copy user accounts, passwords, sessions, or other organizations;
provision matching destination users before import. Imported sites are placed
in demo mode with rotated site credentials and no deployment targets. This
workflow does not replace a full-instance backup.

## Retained media cleanup

Areca protects assets referenced by drafts, revisions, publication snapshots,
and deleted-content archives. See [asset and authoring history retention](ASSET_RETENTION.md)
for organization deletion and retrying queued object cleanup. Do not remove
storage objects manually while they may still be referenced.
