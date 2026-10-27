ALTER TABLE "audit_log" ADD COLUMN "agency_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "audit_log" SET "agency_only" = true WHERE "site_id" IN (SELECT "id" FROM "site" WHERE "environment" = 'development') OR "action" LIKE 'dev\_env.%';
