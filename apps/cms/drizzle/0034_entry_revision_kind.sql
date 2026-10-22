ALTER TABLE "entry_revision" ADD COLUMN "kind" text DEFAULT 'milestone' NOT NULL;--> statement-breakpoint
UPDATE "entry_revision" SET "kind" = 'autosave' WHERE "note" = 'update';--> statement-breakpoint
CREATE INDEX "entry_revision_entry_created_idx" ON "entry_revision" USING btree ("entry_id","created_at","id");--> statement-breakpoint
CREATE INDEX "entry_revision_kind_created_idx" ON "entry_revision" USING btree ("kind","created_at");