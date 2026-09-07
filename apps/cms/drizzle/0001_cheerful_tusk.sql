ALTER TABLE "publication" ADD COLUMN "was_live" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "publication" SET "was_live" = true
WHERE "status" IN ('live', 'superseded', 'rolled_back') OR "deployed_at" IS NOT NULL;