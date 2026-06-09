ALTER TABLE "qr_presets" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "qr_presets" ADD CONSTRAINT "qr_presets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qr_presets_project_idx" ON "qr_presets" USING btree ("project_id","created_at");