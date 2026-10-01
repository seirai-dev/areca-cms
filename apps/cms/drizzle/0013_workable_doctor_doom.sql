CREATE TABLE "scheduler_backoff" (
	"site_id" text PRIMARY KEY NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "scheduled_by" text;--> statement-breakpoint
ALTER TABLE "scheduler_backoff" ADD CONSTRAINT "scheduler_backoff_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_scheduled_by_user_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;