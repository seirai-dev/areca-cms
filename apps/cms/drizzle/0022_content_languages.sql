ALTER TABLE "asset" ADD COLUMN "alt_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "collection" ADD COLUMN "required_languages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "collection" ADD COLUMN "localized_routes" jsonb;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "languages" jsonb;