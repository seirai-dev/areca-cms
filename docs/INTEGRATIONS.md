# Integration reliability

This is the operating contract for the integrations covered by CMS audit section
7: the frontend SDK, Dokploy deployment, S3 storage and invitation email. General
content webhooks and search, commerce, analytics, translation or DAM consumers
require an identified product need before adding another adapter or event system.

## Identity and publication requests

Each release has a publication ID, immutable snapshot and snapshot hash. A build
job identifies that publication and its site; logs and publication audit metadata
include the job ID. The SDK's current snapshot endpoint uses the publication
pinned to the site's active or uncertain job, falling back to the latest
successful live release in Production mode or demo publication in Demo mode. The worker
checks the site's reported publication ID before marking a deployment live.

Publish and rollback RPCs require a UUID `requestKey`. Retrying the same key,
actor, site, operation and payload returns the original publication and job,
including their current status. It does not enqueue, coalesce or audit another
release. Reusing a key for a different actor, site, operation or payload reports
a conflict. Request records remain in PostgreSQL with their publication history.

The Go-live UI retains the request key and payload in local browser storage until
the request resolves, including across a page reload after a lost response. It
does not silently replace an unresolved request with different options. A new
deliberate publication after a resolved request receives a new key. Custom callers
must likewise retain their key until they establish the outcome; creating a fresh
key after a timeout deliberately requests a separate release.

Scheduled releases run as the system. Their `publication.requested` audit entry
records `scheduledBy` and, for multiple approvers, `approvers`; a single approver
is the audit actor. `publication.requestedBy` can remain null for a scheduled
release. These audit fields describe the approvers of due scheduled entries,
not the author of every entry in the site snapshot.

## Deployment delivery and recovery

Release enqueueing freezes the deployment target and upstream connection URL.
The worker persists dispatch intent before calling Dokploy. Adapter calls carry the job ID, publication ID and snapshot hash. The
adapter sets `ARECA_SNAPSHOT_ID` to the publication ID before deploying and tags
the Dokploy deployment with `title=areca:<jobId>` plus publication and hash in its
description. Completion polling follows that matching deployment's ID, not the
application’s overall status.

The saved target pins the application ID and health URL. Changing or removing
the organization's Dokploy connection is blocked while jobs are queued, active,
or uncertain; replacing a credential on the same host is supported. Sites may
share an application, but its deployments are serialized across organizations
and remain blocked by uncertain dispatches until resolution.

Safe application reads and identical environment writes have at most three
attempts with short exponential backoff for transient failures. The deployment
POST is sent once. If its response is lost or ambiguous, the adapter searches for
the existing tagged deployment before proceeding. A worker recovered after a
persisted intent also reconciles instead of sending another deployment POST.

An unresolved dispatch or completion timeout leaves the job failed with an
uncertain outcome. Its exact saved publication remains available to explicitly
pinned builds; ordinary manual pulls continue reading the successful release.
New publish/rollback requests, queued jobs and scheduler work for that site are
blocked while the uncertainty exists, preventing another build from taking its
snapshot. The previously live publication remains live.

1. Open the failed job's details in **Go-live** and note its job/publication IDs.
   In Dokploy, inspect the application's deployment history for
   `areca:<jobId>` and the matching publication/hash description. Do not manually
   launch a replacement while the original build might still run.
2. Use **Reconcile deployment** on that job after restoring Dokploy connectivity
   or allowing its deployment record to appear. This resumes polling the same
   dispatch and then checks the publication-specific health response.
3. If no matching record can be established, retain the block and investigate
   upstream. A missing record is not proof that the deploy request was rejected.
   Once an agency administrator has verified that upstream work is stopped and
   drained (including queued builds), they can explicitly resolve the uncertain
   job with that confirmation and an investigation reason. This transaction
   records `publication.dispatch_resolved` with the administrator and reason,
   marks the publication failed and releases the site for a new deliberate
   publication. It never sends a deploy request or marks the uncertain release
   live. Owners can reconcile but cannot perform this terminal resolution.

Confirmed deployment errors and safe failures before dispatch release the pin
and leave the previous release live. They can be followed by a new deliberate
publication. Old jobs recovered from `deploying` without dispatch identity also
require manual investigation; they cannot safely be reconstructed as a new POST.

## Invitation recovery

Invitation creation persists the invitation and audit record, then queues the
email in `email_outbox`. The request makes one immediate send attempt, bounded
by the mail adapter's 15-second timeouts. Failed attempts are retried by the
outbox worker about 1 and 5 minutes later, and then marked failed. Errors that
waiting cannot fix, such as rejected credentials or a refused recipient, fail
at once. Draft saves do not send email or deploy a site. A failed row keeps a
readable, redacted error for the People list and Agency → Mail → Recent emails.

In **People**, owners or agency administrators can resend an invitation, copy
its acceptance link, or revoke it. **Copy link** works whether or not the email
was delivered. A resend rotates the token and renews the seven-day expiry, so
the old acceptance link stops working even if SMTP still fails. Use **Send
again** after fixing the mail settings; submitting another invitation while one
is pending deliberately reports a conflict. A copied link is a bearer capability:
share it only with its recipient. Acceptance requires the signed-in account's
email to match the invitation. Accepted or revoked invitations cannot be resent.

Delivery status `sent` means the SMTP server accepted the message, not that the
recipient read it or that it escaped spam filtering. Delivery is at least once:
if the worker crashes after SMTP accepts a message but before it records that,
the email is sent again after the lease expires, so a recipient may get a
duplicate. A manual resend creates a fresh link.

## Secrets and diagnostics

Organization Dokploy API keys are encrypted with AES-256-GCM and organization
context, and the browser receives credential status only. Site and preview tokens
belong on the server or in the site's build secrets. SDK schema-write credentials
belong only in the schema authoring environment. Dokploy requests require HTTPS
in production and reject redirects.

Operational JSON logs use the central redactor. Invitation failures additionally
redact their acceptance token before writing either logs or the stored diagnostic.
Mail logs use the `mail` component and carry the outbox ID, kind, attempt and
SMTP response code. SMTP passwords, links and tokens are redacted from logs and
from the stored error.
Build log appends are atomic in PostgreSQL: concurrent writers retain all lines
while under the cap. Each line is bounded to about 8 Ki characters and each job
log to 256 Ki characters, retaining the tail with one truncation marker.

Use job, publication and site IDs to correlate Go-live details, build logs and
audit records. Existing readiness checks, metrics and suggested alerts cover
failed/stuck jobs and scheduler failures; see [operations](OPERATIONS.md).
Configuring the monitoring system to evaluate those alerts is an operator task.

## Credential rotation

For ordinary Dokploy API-key rotation, create a replacement key in Dokploy,
save it in the organization's CMS settings, verify the connection and then revoke
the old key. For database, Redis, S3 or SMTP credentials, change the service's
credential, update the CMS secret configuration and restart the CMS instances. For the SMTP
password saved in Agency → Mail, enter the new password there instead; no
restart is needed.
Site token rotation invalidates the old token immediately; update the site's
Dokploy build secrets and local SDK configuration together.

The encryption key has no automated re-encryption tool. To rotate
`DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`:

1. Pause publication workers and scheduling on every CMS instance and take a
   database backup paired with the current encryption key. Keep that key securely
   with backups encrypted under it. Obtain replacement Dokploy API keys for each
   configured organization before changing the encryption key.
2. Generate a fresh 32-byte base64 key through the existing secrets management
   process. Set the same new value on every CMS instance and restart them together
   with workers still paused. Old encrypted credentials cannot be read at this
   point.
3. Re-enter each organization's Dokploy API key through agency administration.
   Verify each connection, then take a new database backup paired with the new
   encryption key before resuming workers and scheduling.

If rotation must be abandoned, restore the pre-rotation database and its matching
key together. Merely changing the environment key back does not decrypt rows
already replaced under the new key. Never rotate the encryption key as part of an
ordinary upgrade or restore. See [deployment](DEPLOYMENT.md) and
[recovery](../docker/RECOVERY.md) for the existing secret and backup procedures.

## Verification

Focused regression suites in `apps/cms/src/` cover:

- `server/publishing/request-idempotency.db.test.ts`: request replay and identity
  conflicts without duplicate publications/jobs/audit writes.
- `features/golive/request-identity.test.ts`: browser request-key lifecycle
  and retained request identity after lost responses.
- `adapters/deployment/dokploy.test.ts` and
  `server/publishing/deployment-delivery.db.test.ts`: exact dispatch identity,
  bounded retries, uncertain outcome quarantine, reconciliation and terminal
  resolution.
- `server/publishing/publishing.test.ts` and `worker-pool.db.test.ts`: publishing
  and queue concurrency/lease regressions.
- `server/admin/invitation-delivery.test.ts`: SMTP failure, resend, old-link
  invalidation, recipient matching and redaction.
- `server/ops/ops.db.test.ts` and `server/log.test.ts`: atomic appends, log bounds,
  metrics and central redaction.
- Relevant rows of `server/security/authz-matrix.test.ts`: publish/rollback,
  owner reconciliation, agency-only terminal resolution, and invitation recovery
  permissions including tenant isolation.

Database suites require an isolated PostgreSQL database with all migrations
applied; do not reset the development database to run them. Run suites that claim
the global job queue sequentially to avoid claiming another suite's fixtures.
The additive migrations were also checked against a database containing an
existing deploying job. Automated validation uses fake adapters; live Dokploy
and end-to-end browser UI verification are not claimed.

## Site-scoped AI media

AI tools can use assets referenced by their site’s content, retained versions,
archives, or publications, plus assets uploaded through AI for that site.
The ordinary client media library stays shared across the client organization.
A tool connection cannot browse or modify unrelated assets from another site
just because both sites belong to the same client.
