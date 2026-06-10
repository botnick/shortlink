ALTER TABLE `sessions` ADD `public_id` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `sessions` SET `public_id` = lower(hex(randomblob(16))) WHERE `public_id` = '';--> statement-breakpoint
ALTER TABLE `sessions` ADD `browser` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `os` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `device_type` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `country` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_active_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_public_idx` ON `sessions` (`public_id`);