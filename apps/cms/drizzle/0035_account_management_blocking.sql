ALTER TABLE "oauthClient" DROP CONSTRAINT "oauthClient_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "blocked_by_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "oauthClient" ADD CONSTRAINT "oauthClient_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_blocked_by_id_user_id_fk" FOREIGN KEY ("blocked_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;