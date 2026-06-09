CREATE TABLE "link_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"domain_id" uuid,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "links_slug_idx";--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "domain_id" uuid;--> statement-breakpoint
ALTER TABLE "link_aliases" ADD CONSTRAINT "link_aliases_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_aliases" ADD CONSTRAINT "link_aliases_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "link_aliases_domain_slug_idx" ON "link_aliases" USING btree (coalesce("domain_id", '00000000-0000-0000-0000-000000000000'::uuid),"slug");--> statement-breakpoint
CREATE INDEX "link_aliases_slug_idx" ON "link_aliases" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "link_aliases_link_idx" ON "link_aliases" USING btree ("link_id");--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "links_domain_slug_idx" ON "links" USING btree (coalesce("domain_id", '00000000-0000-0000-0000-000000000000'::uuid),"slug");--> statement-breakpoint
CREATE INDEX "links_slug_idx" ON "links" USING btree ("slug");