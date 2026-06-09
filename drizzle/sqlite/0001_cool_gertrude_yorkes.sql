CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hostname` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cf_hostname_id` text,
	`verification` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_idx` ON `domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `domains_user_idx` ON `domains` (`user_id`,`created_at`);