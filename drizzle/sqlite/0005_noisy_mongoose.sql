ALTER TABLE `qr_presets` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `qr_presets_project_idx` ON `qr_presets` (`project_id`,`created_at`);