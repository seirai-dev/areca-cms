# Upgrade for the ten highest-risk audit findings

These changes address only the ten findings in `CMS_AUDIT.md` under “Highest-risk confirmed findings.”

1. Take a coordinated database/object/key backup using [the recovery runbook](../docker/RECOVERY.md). Stop every CMS and publishing worker before applying migrations; old workers cannot use the new leases and approved-version model.
2. Apply migrations `0007` and `0008` with the existing deployment migration command. `0007` backfills approved slugs from approved content, freezes legacy schedules, fails interrupted active jobs, and coalesces duplicate queued jobs before installing queue uniqueness indexes. Review legacy scheduled drafts before enabling workers: prior scheduling did not preserve the original approved version, so migration can only freeze the current stored draft. Previously leaked approved slugs can only be recovered if approved content still contains its slug.
3. Production is the default site mode. Configure a Dokploy application and a health endpoint that returns the actual publication ID before publishing. Explicit demo sites create visibly labeled demo publications without production-live claims. Retry releases interrupted by migration after verifying deployment state.
4. Existing build tokens remain valid for reading content and manifests, but cannot POST manifests. Rotate a separate schema-write token in Developer settings and configure `ARECA_SCHEMA_TOKEN` only in the schema integration. See [the SDK instructions](../packages/site-sdk/README.md). Collection and field keys must satisfy the new identifier rules; rename invalid legacy identifiers deliberately before syncing or pulling them.
5. Owners approve the entire version, including its slug. Scheduling freezes that version and keeps the previous approved content eligible until due. Later edits remain drafts; inspect the approved scheduled version in the editor before rescheduling. Deployment completion promotes only matching scheduled identities captured by that publication.
6. Editors now save with an expected draft version. A stale save pauses with a conflict; reload the current version or explicitly reapply the recovered draft. Browser-local buffers are scoped to user/site/collection/entry. Save timeouts keep navigation blocked unless the user explicitly leaves; recovery remains available in that browser.
7. All retained revisions/publications and deleted-content archives protect referenced assets, including legacy rich-text image URLs. Explicit organization deletion removes that organization’s retained history and queues its object cleanup. Retry storage cleanup using [the asset retention instructions](ASSET_RETENTION.md).
8. Exercise full restore and organization export/import on an isolated instance before relying on recovery. Organization imports preserve authoring history and asset bytes, map permissions to provisioned destination users, and begin as offline demo sites; original deployment/integration eligibility is not replayed.

The migrations are included for operators to apply. Implementation validation used separate Docker services and databases, not the configured development database. Real deployment verification still requires a configured production target and its publication-aware health endpoint.

## Implementation verification

Validated on 2026-10-01 using isolated PostgreSQL, RustFS, Redis and Mailpit services:

- CMS: 40 test files / 209 tests passed, TypeScript check and production build passed.
- Site SDK: 94 tests passed, TypeScript check and production build passed.
- Authoring bundle validation: six tests passed; actual export/import preserved draft/approved/scheduled versions, revisions, retained deletion archives, mapped permissions and exact asset bytes.
- Recovery configuration: three tests passed; coordinated cold backup restored authoring tables, permissions/history, approved/scheduled versions, a real S3 object and an encrypted credential decrypted with the preserved key. Restore also passed with deliberately conflicting ambient S3 credentials.
- Upgrade migration tested against legacy slug data and duplicated queued/active jobs; approved slug backfill, frozen schedules and queue cleanup matched expectations.
- Authenticated sign-in and settings SSR returned HTTP 200; anonymous snapshot access returned HTTP 401. Interactive browser verification was blocked by repeated collaborative-preview navigation failures. No real Dokploy deployment was triggered.

A targeted ESLint invocation still reports `no-unnecessary-condition` findings around database-row existence checks, including existing code. No claim of a clean lint run is made.
