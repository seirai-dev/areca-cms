CREATE INDEX "email_outbox_queued_due_idx" ON "email_outbox" USING btree ("next_attempt_at") WHERE "email_outbox"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "email_outbox_lease_expiry_idx" ON "email_outbox" USING btree ("lease_until") WHERE "email_outbox"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "entry_scheduled_due_idx" ON "entry" USING btree ("scheduled_at") WHERE "entry"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "publication_site_status_idx" ON "publication" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "storage_deletion_unpaused_idx" ON "storage_object_deletion" USING btree ("created_at") WHERE "storage_object_deletion"."attempts" < 4;