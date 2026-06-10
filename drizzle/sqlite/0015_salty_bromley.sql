CREATE TABLE `deleted_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deleted_accounts_email_idx` ON `deleted_accounts` (`email`);--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` integer;