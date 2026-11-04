CREATE TABLE "asset_upload_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"organization_id" text NOT NULL,
	"site_id" text NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text,
	"max_files" integer NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_upload_session_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "asset_upload_session_reserved_check" CHECK ("asset_upload_session"."reserved_count" >= 0 and "asset_upload_session"."reserved_count" <= "asset_upload_session"."max_files")
);
--> statement-breakpoint
CREATE TABLE "asset_upload_session_file" (
	"session_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_upload_session_file_unique" UNIQUE("session_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "asset_upload_session" ADD CONSTRAINT "asset_upload_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload_session" ADD CONSTRAINT "asset_upload_session_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload_session" ADD CONSTRAINT "asset_upload_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload_session_file" ADD CONSTRAINT "asset_upload_session_file_session_id_asset_upload_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."asset_upload_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload_session_file" ADD CONSTRAINT "asset_upload_session_file_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_upload_session_site_id_idx" ON "asset_upload_session" USING btree ("site_id");