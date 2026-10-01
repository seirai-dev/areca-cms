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

The command processes up to 1,000 objects per invocation and can be scheduled by
the operator. Successful deletes clear their records; failed deletes remain with
a diagnostic error. Uploads compensate failed database inserts by deleting the
just-uploaded object, or recording its storage key for cleanup if that deletion
fails and the database is reachable.
