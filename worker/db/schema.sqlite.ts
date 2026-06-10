import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Coalesce a NULL domain (the default short host) to '' so it participates in
// the per-domain unique slug index — SQLite treats NULLs as distinct otherwise.
// Written as a raw expression (no column interpolation) so drizzle-kit emits it
// verbatim in the generated migration.
const DOMAIN_BUCKET = sql`coalesce(domain_id, '')`;

// SQLite (Cloudflare D1) mirror of schema.ts. Same table/column names so the
// query layer is dialect-agnostic; only the column storage types differ
// (uuid→text, timestamptz→unix integer, jsonb→json text, boolean→0/1,
// bigserial→autoincrement integer). `casing: "snake_case"` (set on the drizzle
// client) keeps the on-disk column names identical to the Postgres schema.

const uuid = () => crypto.randomUUID();
const now = () => new Date();

export const users = sqliteTable(
  "users",
  {
    id: text().primaryKey().$defaultFn(uuid),
    email: text().notNull(),
    passwordHash: text().notNull(),
    role: text({ enum: ["user", "admin"] })
      .notNull()
      .default("user"),
    isPrimary: integer({ mode: "boolean" }).notNull().default(false),
    // Soft delete: purged by cron once the hold window passes.
    deletedAt: integer({ mode: "timestamp" }),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

// Tombstones for closed accounts (keeps the email unregistrable for a window).
export const deletedAccounts = sqliteTable(
  "deleted_accounts",
  {
    id: text().primaryKey().$defaultFn(uuid),
    email: text().notNull(),
    deletedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("deleted_accounts_email_idx").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    // Safe identifier for listing/revoking — `id` is the secret token.
    publicId: text().notNull().$defaultFn(uuid),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    browser: text(),
    os: text(),
    deviceType: text(),
    country: text(),
    lastActiveAt: integer({ mode: "timestamp" }),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("sessions_public_idx").on(t.publicId),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

export const links = sqliteTable(
  "links",
  {
    id: text().primaryKey().$defaultFn(uuid),
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
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text().references(() => projects.id, { onDelete: "set null" }),
    // Custom domain the back-half lives on; null = default short host.
    domainId: text().references(() => domains.id),
    isActive: integer({ mode: "boolean" }).notNull().default(true),
    expiresAt: integer({ mode: "timestamp" }),
    clickCount: integer().notNull().default(0),
    previewMode: text().notNull().default("off"),
    ogTitle: text(),
    ogDescription: text(),
    ogImage: text(),
    // Saved QR design (a QrCfg JSON) so the studio's choice shows everywhere.
    qrConfig: text({ mode: "json" }),
    // Free-form labels for organising/filtering links (a JSON string array).
    tags: text({ mode: "json" }).$type<string[]>(),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("links_domain_slug_idx").on(DOMAIN_BUCKET, t.slug),
    index("links_slug_idx").on(t.slug),
    index("links_user_created_idx").on(t.userId, t.createdAt),
    index("links_project_created_idx").on(t.projectId, t.createdAt),
  ],
);

// Retired back-halves kept alive so old shared links still redirect (Bitly-style).
export const linkAliases = sqliteTable(
  "link_aliases",
  {
    id: text().primaryKey().$defaultFn(uuid),
    linkId: text()
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    domainId: text().references(() => domains.id),
    slug: text().notNull(),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("link_aliases_domain_slug_idx").on(DOMAIN_BUCKET, t.slug),
    index("link_aliases_slug_idx").on(t.slug),
    index("link_aliases_link_idx").on(t.linkId),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text().primaryKey().$defaultFn(uuid),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text(),
    logo: text(),
    // Default custom domain for new links in this project (null = default host).
    defaultDomainId: text().references(() => domains.id, { onDelete: "set null" }),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("projects_user_idx").on(t.userId, t.createdAt)],
);

export const clicks = sqliteTable(
  "clicks",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    linkId: text()
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
    country: text(),
    referrer: text(),
    browser: text(),
    os: text(),
    deviceType: text(),
    ipHash: text(),
    // Bot/automation traffic — kept for auditing, excluded from analytics.
    isBot: integer({ mode: "boolean" }),
  },
  (t) => [
    index("clicks_link_created_idx").on(t.linkId, t.createdAt),
    // Mirrors schema.ts — global analytics filter created_at alone.
    index("clicks_created_idx").on(t.createdAt),
  ],
);

export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text({ mode: "json" }).notNull(),
});

export const qrPresets = sqliteTable(
  "qr_presets",
  {
    id: text().primaryKey().$defaultFn(uuid),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    config: text({ mode: "json" }).notNull(),
    projectId: text().references(() => projects.id, { onDelete: "cascade" }),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("qr_presets_user_idx").on(t.userId, t.createdAt),
    index("qr_presets_project_idx").on(t.projectId, t.createdAt),
  ],
);

// Programmatic access tokens (hash-only storage; key shown once at creation).
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text().primaryKey().$defaultFn(uuid),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    keyHash: text().notNull(),
    prefix: text().notNull(),
    lastUsedAt: integer({ mode: "timestamp" }),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    index("api_keys_user_idx").on(t.userId, t.createdAt),
  ],
);

// Human check v3 — see schema.ts for the full commentary. Mirror, same names.
export const humanChallenges = sqliteTable(
  "human_challenges",
  {
    id: text().primaryKey().$defaultFn(uuid),
    refHash: text().notNull(),
    action: text().notNull(),
    hostname: text().notNull(),
    clientKey: text().notNull(),
    mode: text().notNull(),
    status: text().notNull().default("active"), // "active" | "done" | "locked"
    version: integer().notNull().default(0),
    gameIndex: integer().notNull().default(0),
    gamesTotal: integer().notNull().default(0),
    retries: integer().notNull().default(0),
    powDifficulty: integer().notNull().default(0),
    powDone: integer({ mode: "boolean" }).notNull().default(false),
    riskScore: integer().notNull().default(0),
    game: text({ mode: "json" }),
    playedTypes: text({ mode: "json" }).$type<string[]>(),
    issuedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("human_challenges_ref_idx").on(t.refHash),
    index("human_challenges_expires_idx").on(t.expiresAt),
  ],
);

export const humanVerifications = sqliteTable(
  "human_verifications",
  {
    id: text().primaryKey().$defaultFn(uuid),
    tokenHash: text().notNull(),
    challengeId: text().notNull(),
    action: text().notNull(),
    hostname: text().notNull(),
    clientKey: text().notNull(),
    issuedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    consumedAt: integer({ mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("human_verifications_token_idx").on(t.tokenHash),
    index("human_verifications_expires_idx").on(t.expiresAt),
  ],
);

export const domains = sqliteTable(
  "domains",
  {
    id: text().primaryKey().$defaultFn(uuid),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostname: text().notNull(),
    status: text().notNull().default("pending"), // "pending" | "verified" | "active"
    verifyToken: text().notNull(),
    verifiedAt: integer({ mode: "timestamp" }),
    cfHostnameId: text(),
    cfRecords: text({ mode: "json" }),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("domains_hostname_idx").on(t.hostname),
    index("domains_user_idx").on(t.userId, t.createdAt),
  ],
);
