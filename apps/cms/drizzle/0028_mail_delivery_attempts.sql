CREATE TABLE "email_delivery_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"outbox_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"error_params" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_delivery_attempt" ADD CONSTRAINT "email_delivery_attempt_outbox_id_email_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."email_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_delivery_attempt_created_at_idx" ON "email_delivery_attempt" USING btree ("created_at");