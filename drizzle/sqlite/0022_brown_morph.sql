CREATE TABLE `click_rollups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`link_id` text NOT NULL,
	`bucket` integer NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`referrer_domain` text DEFAULT '' NOT NULL,
	`browser` text DEFAULT '' NOT NULL,
	`os` text DEFAULT '' NOT NULL,
	`device_type` text DEFAULT '' NOT NULL,
	`is_bot` integer DEFAULT false NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `click_rollups_dims_idx` ON `click_rollups` (`link_id`,`bucket`,`country`,`referrer_domain`,`browser`,`os`,`device_type`,`is_bot`);--> statement-breakpoint
CREATE INDEX `click_rollups_link_bucket_idx` ON `click_rollups` (`link_id`,`bucket`);--> statement-breakpoint
CREATE INDEX `click_rollups_bucket_idx` ON `click_rollups` (`bucket`);