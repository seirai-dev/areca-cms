ALTER TABLE "collection" ADD COLUMN "kind" text DEFAULT 'collection' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection" ADD COLUMN "seo_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collection" ADD COLUMN "preview_path" text;