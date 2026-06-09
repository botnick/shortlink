ALTER TABLE "domains" ADD COLUMN "cf_hostname_id" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "cf_records" jsonb;