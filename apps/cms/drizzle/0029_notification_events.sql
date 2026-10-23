CREATE TABLE "notification_event" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"site_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_publication_id_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_kind_publication_unique" ON "notification_event" USING btree ("kind","publication_id");--> statement-breakpoint
CREATE INDEX "notification_event_pending_idx" ON "notification_event" USING btree ("next_attempt_at") WHERE "notification_event"."status" = 'pending';