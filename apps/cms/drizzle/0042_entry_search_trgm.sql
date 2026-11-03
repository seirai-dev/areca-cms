CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "entry_slug_trgm_idx" ON "entry" USING gin ("slug" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "entry_draft_text_trgm_idx" ON "entry" USING gin (("draft_data"::text) gin_trgm_ops);