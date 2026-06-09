CREATE TABLE `link_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`domain_id` text,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `link_aliases_domain_slug_idx` ON `link_aliases` (coalesce(`domain_id`, ''), `slug`);--> statement-breakpoint
CREATE INDEX `link_aliases_slug_idx` ON `link_aliases` (`slug`);--> statement-breakpoint
CREATE INDEX `link_aliases_link_idx` ON `link_aliases` (`link_id`);--> statement-breakpoint
DROP INDEX `links_slug_idx`;--> statement-breakpoint
ALTER TABLE `links` ADD `domain_id` text REFERENCES domains(id);--> statement-breakpoint
CREATE UNIQUE INDEX `links_domain_slug_idx` ON `links` (coalesce(`domain_id`, ''), `slug`);--> statement-breakpoint
CREATE INDEX `links_slug_idx` ON `links` (`slug`);