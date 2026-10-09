CREATE TABLE "ai_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"encrypted_api_key" text,
	"model" text,
	"system_prompt" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "ai_prompt" text;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;