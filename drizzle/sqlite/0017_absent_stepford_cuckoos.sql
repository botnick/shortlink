CREATE TABLE `human_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`ref_hash` text NOT NULL,
	`action` text NOT NULL,
	`hostname` text NOT NULL,
	`client_key` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`game_index` integer DEFAULT 0 NOT NULL,
	`games_total` integer DEFAULT 0 NOT NULL,
	`retries` integer DEFAULT 0 NOT NULL,
	`pow_difficulty` integer DEFAULT 0 NOT NULL,
	`pow_done` integer DEFAULT false NOT NULL,
	`risk_score` integer DEFAULT 0 NOT NULL,
	`game` text,
	`played_types` text,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `human_challenges_ref_idx` ON `human_challenges` (`ref_hash`);--> statement-breakpoint
CREATE INDEX `human_challenges_expires_idx` ON `human_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `human_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`challenge_id` text NOT NULL,
	`action` text NOT NULL,
	`hostname` text NOT NULL,
	`client_key` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `human_verifications_token_idx` ON `human_verifications` (`token_hash`);--> statement-breakpoint
CREATE INDEX `human_verifications_expires_idx` ON `human_verifications` (`expires_at`);