ALTER TABLE "branding" ADD COLUMN "advanced_colors_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "branding" ADD COLUMN "advanced_colors" jsonb;