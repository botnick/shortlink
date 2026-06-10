CREATE TABLE "human_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref_hash" text NOT NULL,
	"action" text NOT NULL,
	"hostname" text NOT NULL,
	"client_key" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"game_index" integer DEFAULT 0 NOT NULL,
	"games_total" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"pow_difficulty" integer DEFAULT 0 NOT NULL,
	"pow_done" boolean DEFAULT false NOT NULL,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"game" jsonb,
	"played_types" jsonb,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"challenge_id" uuid NOT NULL,
	"action" text NOT NULL,
	"hostname" text NOT NULL,
	"client_key" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "human_challenges_ref_idx" ON "human_challenges" USING btree ("ref_hash");--> statement-breakpoint
CREATE INDEX "human_challenges_expires_idx" ON "human_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "human_verifications_token_idx" ON "human_verifications" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "human_verifications_expires_idx" ON "human_verifications" USING btree ("expires_at");