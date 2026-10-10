# Asset and authoring history retention

Assets remain protected while any draft, approved or scheduled version, revision,
publication snapshot, or deleted-content archive references them. This includes
legacy rich-text images stored as `/api/assets/file/<storage-key>` URLs. Removing
an image from the latest draft does not make an image used in history deletable.

Deleting an entry, collection, or site removes it from active authoring, but
preserves its authoring versions and revisions in `deleted_content_archive`.
Site archives also preserve collection definitions, publications, and build
history. Archives belong to the organization and are included in its versioned
authoring export. There is no automatic history expiration or archive purge.
Asset deletion remains blocked by references in these archives.

Explicitly deleting an organization removes its archives and asset database
rows. Asset object keys are first recorded in the durable
`storage_object_deletion` table, which survives organization deletion. Storage
failures leave records in that table for a later retry. The organization must
have no active sites before deletion.

To retry pending object deletion, run the cleanup command with the same storage
and database configuration as the CMS:

```sh
cd apps/cms
node --env-file=.env.local scripts/cleanup-assets.mjs
```

The CMS maintenance loop automatically processes eligible cleanup records. A
failed delete retries after 1, 5, and 15 minutes, then pauses after the initial
attempt and three retries. Fix the storage issue and explicitly restart paused
work with `node --env-file=.env.local scripts/cleanup-assets.mjs --retry-paused`.
The command processes up to 1,000 objects per invocation and honors retry delays.
Successful deletes clear their records; failed deletes retain a diagnostic error.

Asset and branding uploads persist a cleanup intent before storing bytes, then
clear it in the successful database transaction. Failed uploads compensate the
new object immediately; process death leaves its intent eligible for later
cleanup. Cleanup preserves objects that became owned by a committed asset or
current branding configuration after a lost transaction response. Old branding
images are queued durably when replaced, cleared, or reset.

Raster uploads validate decoded bytes against the declared PNG, JPEG, WebP, or
GIF format before storage. Branding also validates ICO structure. Invalid or
mislabeled image contents return a user-readable validation error.
