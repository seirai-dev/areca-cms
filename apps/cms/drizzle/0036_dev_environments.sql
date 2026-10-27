CREATE TABLE "environment_push" (
	"id" text PRIMARY KEY NOT NULL,
	"dev_site_id" text,
	"production_site_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"counts" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "origin_entry_id" text;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "origin_baseline" jsonb;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "origin_content_version" integer;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "environment" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "parent_site_id" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "schema_baseline" jsonb;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "last_forked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "last_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "environment_push" ADD CONSTRAINT "environment_push_dev_site_id_site_id_fk" FOREIGN KEY ("dev_site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_push" ADD CONSTRAINT "environment_push_production_site_id_site_id_fk" FOREIGN KEY ("production_site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_push" ADD CONSTRAINT "environment_push_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "environment_push_production_created_idx" ON "environment_push" USING btree ("production_site_id","created_at");--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_parent_site_id_site_id_fk" FOREIGN KEY ("parent_site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_parent_site_id_unique" ON "site" USING btree ("parent_site_id") WHERE "site"."parent_site_id" is not null;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_environment_production_check" CHECK (environment = 'production' or (parent_site_id is not null and publishing_mode = 'demo' and deployment_target is null));--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_environment_parent_check" CHECK (environment = 'development' or parent_site_id is null);