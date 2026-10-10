CREATE TABLE "mcp_key" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"allow_go_live" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_key_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "mcp_key" ADD CONSTRAINT "mcp_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_key" ADD CONSTRAINT "mcp_key_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_key_site_id_idx" ON "mcp_key" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "mcp_key_user_id_idx" ON "mcp_key" USING btree ("user_id");