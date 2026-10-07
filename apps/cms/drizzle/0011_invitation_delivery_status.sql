ALTER TABLE "invitation" ADD COLUMN "delivery_status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "last_delivery_error" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "last_sent_at" timestamp with time zone;