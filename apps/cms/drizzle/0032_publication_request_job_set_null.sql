ALTER TABLE "publication_request" DROP CONSTRAINT "publication_request_job_id_build_job_id_fk";
--> statement-breakpoint
ALTER TABLE "publication_request" ALTER COLUMN "job_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_request" ADD CONSTRAINT "publication_request_job_id_build_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."build_job"("id") ON DELETE set null ON UPDATE no action;