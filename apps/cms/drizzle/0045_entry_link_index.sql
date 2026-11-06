CREATE TABLE "entry_link" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"source_entry_id" text NOT NULL,
	"locale" text DEFAULT '' NOT NULL,
	"field_key" text NOT NULL,
	"target_entry_id" text NOT NULL,
	"anchor" text DEFAULT '' NOT NULL,
	CONSTRAINT "entry_link_unique" UNIQUE("source_entry_id","locale","field_key","target_entry_id","anchor")
);
--> statement-breakpoint
ALTER TABLE "entry_link" ADD CONSTRAINT "entry_link_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_link" ADD CONSTRAINT "entry_link_source_entry_id_entry_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_link" ADD CONSTRAINT "entry_link_target_entry_id_entry_id_fk" FOREIGN KEY ("target_entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_link_target_idx" ON "entry_link" USING btree ("target_entry_id");--> statement-breakpoint
CREATE INDEX "entry_link_source_idx" ON "entry_link" USING btree ("source_entry_id");