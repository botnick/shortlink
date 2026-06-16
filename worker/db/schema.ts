import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigserial,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Sentinel used so a NULL domain (the default short host) participates in the
// per-domain unique slug index — Postgres treats NULLs as distinct otherwise.
const DEFAULT_DOMAIN = sql`'00000000-0000-0000-0000-000000000000'::uuid`;

export const userRole = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    role: userRole().notNull().default("user"),
    isPrimary: boolean().notNull().default(false),
    // Soft delete: set when the account is closed; the row (and everything in
    // it) is purged by cron once the hold window passes.
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

// Tombstones for closed accounts. Survives the user-row purge so the email
// stays unregistrable for the configured window; pruned by cron afterwards.
export const deletedAccounts = pgTable(
  "deleted_accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    deletedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("deleted_accounts_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    // Safe identifier for listing/revoking in the UI — `id` is the secret token
    // and must never leave the server.
    publicId: uuid().notNull().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Device snapshot from sign-in, for the account page's session list.
    browser: text(),
    os: text(),
    deviceType: text(),
    country: text(),
    lastActiveAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_public_idx").on(t.publicId),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

export const links = pgTable(
  "links",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    destination: text().notNull(),
    // Optional per-OS deep-link targets. When set, the redirect serves the one
    // matching the visitor's platform (else falls back to `destination`).
    iosUrl: text(),
    androidUrl: text(),
    desktopUrl: text(),
    // Optional password gate (PBKDF2 hash). When set, the redirect serves a
    // password prompt instead of forwarding until the visitor unlocks it.
    passwordHash: text(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid().references(() => projects.id, { onDelete: "set null" }),
    // The custom domain this link's back-half lives on; null = the default short
    // host. No onDelete → a domain can't be removed while links still use it.
    domainId: uuid().references(() => domains.id),
    isActive: boolean().notNull().default(true),
    expiresAt: timestamp({ withTimezone: true }),
    clickCount: integer().notNull().default(0),
    // Social preview: "off" (plain redirect) | "custom" | "destination".
    previewMode: text().notNull().default("off"),
    ogTitle: text(),
    ogDescription: text(),
    ogImage: text(),
    // Saved QR design (a QrCfg JSON) so the studio's choice shows everywhere.
    qrConfig: jsonb(),
    // Free-form labels for organising/filtering links (a JSON string array).
    tags: jsonb().$type<string[]>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A back-half is unique per domain (the same slug can exist on another host).
    uniqueIndex("links_domain_slug_idx").on(
      sql`coalesce(${t.domainId}, ${DEFAULT_DOMAIN})`,
      t.slug,
    ),
    // Plain slug index for the redirect lookup (filtered by domain in the query).
    index("links_slug_idx").on(t.slug),
    index("links_user_created_idx").on(t.userId, t.createdAt),
    index("links_project_created_idx").on(t.projectId, t.createdAt),
  ],
);

// Retired back-halves: when a link's domain/slug is edited, the previous
// (domain, slug) is kept here so old shared links keep redirecting (Bitly-style).
// Every alias points at its link; clicks are always logged against that link.
export const linkAliases = pgTable(
  "link_aliases",
  {
    id: uuid().primaryKey().defaultRandom(),
    linkId: uuid()
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    domainId: uuid().references(() => domains.id),
    slug: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("link_aliases_domain_slug_idx").on(
      sql`coalesce(${t.domainId}, ${DEFAULT_DOMAIN})`,
      t.slug,
    ),
    index("link_aliases_slug_idx").on(t.slug),
    index("link_aliases_link_idx").on(t.linkId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    // Per-project branding presets. color = hex; logo = "r2" | http url | null
    // (the image itself lives in R2 at projlogo/<id>). null = inherit the global.
    color: text(),
    logo: text(),
    // Default custom domain for new links in this project (null = default host).
    defaultDomainId: uuid().references(() => domains.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_user_idx").on(t.userId, t.createdAt)],
);

export const clicks = pgTable(
  "clicks",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    linkId: uuid()
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    country: text(),
    referrer: text(),
    browser: text(),
    os: text(),
    deviceType: text(),
    ipHash: text(),
    // Bot/automation traffic (curl, monitors, crawlers). Kept for auditing but
    // excluded from analytics; null on legacy rows = treated as human.
    isBot: boolean(),
  },
  (t) => [
    index("clicks_link_created_idx").on(t.linkId, t.createdAt),
    // Global, link-agnostic analytics (admin overview/analytics) filter on
    // created_at alone — the composite above can't serve that, so without this
    // those aggregates are full-table scans that grow with the clicks history.
    index("clicks_created_idx").on(t.createdAt),
  ],
);

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
});

export const qrPresets = pgTable(
  "qr_presets",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    config: jsonb().notNull(),
    projectId: uuid().references(() => projects.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qr_presets_user_idx").on(t.userId, t.createdAt),
    index("qr_presets_project_idx").on(t.projectId, t.createdAt),
  ],
);

export const domains = pgTable(
  "domains",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostname: text().notNull(),
    status: text().notNull().default("pending"), // "pending" | "verified" | "active"
    verifyToken: text().notNull(),
    verifiedAt: timestamp({ withTimezone: true }),
    cfHostnameId: text(), // Cloudflare for SaaS custom-hostname id (SaaS mode)
    cfRecords: jsonb(), // DNS records to show in SaaS mode
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("domains_hostname_idx").on(t.hostname),
    index("domains_user_idx").on(t.userId, t.createdAt),
    // Serves the daily cron's stale-domain purge (worker/index.ts): filters by
    // status (NOT IN active/verified) bounded by created_at < cutoff.
    index("domains_status_created_idx").on(t.status, t.createdAt),
  ],
);

// Programmatic access tokens. Only a SHA-256 of the key is stored — the key
// itself is shown once at creation. `prefix` (first chars) identifies it in UI.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    keyHash: text().notNull(),
    prefix: text().notNull(),
    lastUsedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    index("api_keys_user_idx").on(t.userId, t.createdAt),
  ],
);

// --- Human check v3 (interactive game CAPTCHA) --------------------------------
// Challenge state machine + one-time verification tokens. These live in the DB
// (not KV) because single-use semantics need atomic claims and KV is eventually
// consistent. Only SHA-256 hashes of the opaque secrets are stored; rows are
// purged by the daily cron once expired.
export const humanChallenges = pgTable(
  "human_challenges",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Hash of the opaque challenge ref the client holds (256-bit random).
    refHash: text().notNull(),
    // Bindings: the action/host/network that minted the challenge must redeem it.
    action: text().notNull(),
    hostname: text().notNull(),
    clientKey: text().notNull(),
    mode: text().notNull(),
    status: text().notNull().default("active"), // "active" | "done" | "locked"
    // Optimistic-concurrency guard: every state transition must match the
    // version it read, so parallel submits can't double-advance or double-issue.
    version: integer().notNull().default(0),
    gameIndex: integer().notNull().default(0),
    gamesTotal: integer().notNull().default(0),
    retries: integer().notNull().default(0),
    powDifficulty: integer().notNull().default(0),
    powDone: boolean().notNull().default(false),
    riskScore: integer().notNull().default(0),
    // Current game instance: public payload + SERVER-ONLY secret state.
    game: jsonb(),
    playedTypes: jsonb().$type<string[]>(),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("human_challenges_ref_idx").on(t.refHash),
    index("human_challenges_expires_idx").on(t.expiresAt),
  ],
);

export const humanVerifications = pgTable(
  "human_verifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Hash of the opaque one-time token (the token itself is never stored).
    tokenHash: text().notNull(),
    challengeId: uuid().notNull(),
    action: text().notNull(),
    hostname: text().notNull(),
    clientKey: text().notNull(),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    // Set exactly once by the atomic consume — single-use enforcement.
    consumedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("human_verifications_token_idx").on(t.tokenHash),
    index("human_verifications_expires_idx").on(t.expiresAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type LinkRow = typeof links.$inferSelect;
export type LinkAliasRow = typeof linkAliases.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ClickRow = typeof clicks.$inferSelect;
export type QrPresetRow = typeof qrPresets.$inferSelect;
export type DomainRow = typeof domains.$inferSelect;
