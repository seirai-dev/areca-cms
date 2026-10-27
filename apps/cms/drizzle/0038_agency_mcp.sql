ALTER TABLE "mcp_connection" ALTER COLUMN "site_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_key" ALTER COLUMN "site_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD COLUMN "scope" text DEFAULT 'site' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_key" ADD COLUMN "scope" text DEFAULT 'site' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connection_agency_active_unique" ON "mcp_connection" USING btree ("user_id","client_id") WHERE "mcp_connection"."revoked_at" is null and "mcp_connection"."scope" = 'agency';--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_scope_check" CHECK ("mcp_connection"."scope" in ('site', 'agency') and (("mcp_connection"."scope" = 'site') = ("mcp_connection"."site_id" is not null)));--> statement-breakpoint
ALTER TABLE "mcp_key" ADD CONSTRAINT "mcp_key_scope_check" CHECK ("mcp_key"."scope" in ('site', 'agency') and (("mcp_key"."scope" = 'site') = ("mcp_key"."site_id" is not null)));