CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`logo` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_user_idx` ON `projects` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `links` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `links_project_created_idx` ON `links` (`project_id`,`created_at`);