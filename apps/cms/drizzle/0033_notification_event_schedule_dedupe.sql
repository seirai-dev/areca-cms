ALTER TABLE "notification_event" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
UPDATE "notification_event" SET "dedupe_key" = "publication_id" WHERE "dedupe_key" IS NULL;--> statement-breakpoint
ALTER TABLE "notification_event" ALTER COLUMN "dedupe_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_event" ALTER COLUMN "publication_id" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "notification_event_kind_publication_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_kind_dedupe_unique" ON "notification_event" USING btree ("kind","dedupe_key");
