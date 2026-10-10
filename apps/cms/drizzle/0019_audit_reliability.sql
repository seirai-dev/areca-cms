CREATE TABLE "ops_counter" (
	"name" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "origin_site_id" text;--> statement-breakpoint
ALTER TABLE "build_job" ADD COLUMN "deployment_resource_key" text;--> statement-breakpoint
ALTER TABLE "build_job" ADD COLUMN "dispatch_connection_url" text;--> statement-breakpoint
ALTER TABLE "build_job" ADD COLUMN "scheduler_fingerprint" text;--> statement-breakpoint
ALTER TABLE "scheduler_backoff" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduler_backoff" ADD COLUMN "approval_fingerprint" text;--> statement-breakpoint
ALTER TABLE "scheduler_backoff" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_object_deletion" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_object_deletion" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_origin_site_id_site_id_fk" FOREIGN KEY ("origin_site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "ops_counter" ("name", "value") SELECT 'publication_failures', count(*) FROM "build_job" WHERE "status" = 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "build_job_one_dispatch_per_resource" ON "build_job" USING btree ("deployment_resource_key") WHERE "build_job"."deployment_resource_key" IS NOT NULL AND ("build_job"."status" IN ('building', 'validating', 'deploying') OR "build_job"."dispatch_uncertain");
