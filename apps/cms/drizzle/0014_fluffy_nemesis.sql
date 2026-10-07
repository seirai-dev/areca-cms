CREATE TABLE "publication_request" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"payload" text NOT NULL,
	"publication_id" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "build_job" ADD COLUMN "dispatch_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "build_job" ADD COLUMN "upstream_deployment_id" text;--> statement-breakpoint
ALTER TABLE "build_job" ADD COLUMN "dispatch_uncertain" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_request" ADD CONSTRAINT "publication_request_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_request" ADD CONSTRAINT "publication_request_publication_id_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_request" ADD CONSTRAINT "publication_request_job_id_build_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."build_job"("id") ON DELETE cascade ON UPDATE no action;