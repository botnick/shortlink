CREATE TABLE "click_rollups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"bucket" integer NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"referrer_domain" text DEFAULT '' NOT NULL,
	"browser" text DEFAULT '' NOT NULL,
	"os" text DEFAULT '' NOT NULL,
	"device_type" text DEFAULT '' NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "click_rollups" ADD CONSTRAINT "click_rollups_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "click_rollups_dims_idx" ON "click_rollups" USING btree ("link_id","bucket","country","referrer_domain","browser","os","device_type","is_bot");--> statement-breakpoint
CREATE INDEX "click_rollups_link_bucket_idx" ON "click_rollups" USING btree ("link_id","bucket");--> statement-breakpoint
CREATE INDEX "click_rollups_bucket_idx" ON "click_rollups" USING btree ("bucket");