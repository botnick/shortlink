ALTER TABLE "links" ADD COLUMN "preview_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "og_title" text;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "og_description" text;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "og_image" text;