DROP INDEX "entry_link_source_idx";--> statement-breakpoint
DROP INDEX "oauth_client_resource_client_idx";--> statement-breakpoint
DROP INDEX "publication_site_id_idx";--> statement-breakpoint
DROP INDEX "publication_site_status_idx";--> statement-breakpoint
CREATE INDEX "asset_storage_key_idx" ON "asset" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" desc);--> statement-breakpoint
CREATE INDEX "audit_log_organization_created_idx" ON "audit_log" USING btree ("organization_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "audit_log_site_created_idx" ON "audit_log" USING btree ("site_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "audit_log_target_created_idx" ON "audit_log" USING btree ("target_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "audit_log_sign_in_idx" ON "audit_log" USING btree ("actor_id","created_at" desc) WHERE "audit_log"."action" = 'user.sign_in';--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "build_job_publication_id_idx" ON "build_job" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "build_job_site_created_idx" ON "build_job" USING btree ("site_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "entry_revision_created_by_idx" ON "entry_revision" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "membership_organization_id_idx" ON "membership" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "publication_site_status_created_idx" ON "publication" USING btree ("site_id","status","created_at" desc);--> statement-breakpoint
CREATE INDEX "publication_site_created_idx" ON "publication" USING btree ("site_id","created_at" desc);