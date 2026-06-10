ALTER TABLE "sessions" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "browser" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "os" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_type" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_public_idx" ON "sessions" USING btree ("public_id");