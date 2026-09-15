CREATE TABLE "branding" (
	"id" text PRIMARY KEY NOT NULL,
	"app_name" text,
	"logo_key" text,
	"logo_mime" text,
	"favicon_key" text,
	"favicon_mime" text,
	"accent_color" text,
	"font" text,
	"email_from_name" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branding" ADD CONSTRAINT "branding_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;