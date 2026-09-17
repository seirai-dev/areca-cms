CREATE TABLE "dokploy_credential" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dokploy_credential" ADD CONSTRAINT "dokploy_credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;