CREATE TABLE "storage_object_deletion" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "build_job" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "published_slug" text;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "draft_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "scheduled_data" jsonb;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "scheduled_slug" text;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "scheduled_version" text;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "entry_versions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "publication" ADD COLUMN "publishing_mode" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "schema_token_hash" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "publishing_mode" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
-- Freeze legacy approved and scheduled values before new releases use them.
UPDATE "entry" e SET published_slug = COALESCE(e.published_data->>'slug', e.published_data->>(SELECT f->>'key' FROM collection c, jsonb_array_elements(c.fields) f WHERE c.id = e.collection_id AND f->>'type' = 'slug' LIMIT 1), e.slug) WHERE e.published_data IS NOT NULL;
--> statement-breakpoint
UPDATE "entry" SET scheduled_data = draft_data, scheduled_slug = slug, scheduled_version = gen_random_uuid()::text WHERE status = 'scheduled';
--> statement-breakpoint
-- Old workers have no fencing lease. Fail interrupted work before enforcing uniqueness.
UPDATE build_job SET status = 'failed', finished_at = now(), error = 'Interrupted by publication safety migration; retry release' WHERE status IN ('building', 'validating', 'deploying');
--> statement-breakpoint
UPDATE publication SET status = 'failed' WHERE status = 'building';
--> statement-breakpoint
WITH ranked AS (SELECT id, row_number() OVER (PARTITION BY site_id ORDER BY priority DESC, created_at DESC, id DESC) AS rank FROM build_job WHERE status = 'queued') UPDATE build_job SET status = 'cancelled', finished_at = now(), error = 'Coalesced by publication safety migration' WHERE id IN (SELECT id FROM ranked WHERE rank > 1);
--> statement-breakpoint
UPDATE publication p SET status = 'failed' WHERE p.status = 'pending' AND EXISTS (SELECT 1 FROM build_job b WHERE b.publication_id = p.id AND b.status = 'cancelled') AND NOT EXISTS (SELECT 1 FROM build_job b WHERE b.publication_id = p.id AND b.status = 'queued');
--> statement-breakpoint
CREATE UNIQUE INDEX "build_job_one_queued_per_site" ON "build_job" USING btree ("site_id") WHERE "build_job"."status" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "build_job_one_active_per_site" ON "build_job" USING btree ("site_id") WHERE "build_job"."status" IN ('building', 'validating', 'deploying');--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_schema_token_hash_unique" UNIQUE("schema_token_hash");