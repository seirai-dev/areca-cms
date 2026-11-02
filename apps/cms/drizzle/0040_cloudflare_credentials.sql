CREATE TABLE "cloudflare_credential" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"encrypted_api_token" text NOT NULL,
	"token_last4" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_verify_result" jsonb,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloudflare_credential" ADD CONSTRAINT "cloudflare_credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudflare_credential" ADD CONSTRAINT "cloudflare_credential_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;