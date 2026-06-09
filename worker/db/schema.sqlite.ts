import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
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
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text(),
    isActive: integer({ mode: "boolean" }).notNull().default(true),
    expiresAt: integer({ mode: "timestamp" }),
    clickCount: integer().notNull().default(0),
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("links_slug_idx").on(t.slug),
    index("links_user_created_idx").on(t.userId, t.createdAt),
  ],
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
  },
  (t) => [index("clicks_link_created_idx").on(t.linkId, t.createdAt)],
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
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("qr_presets_user_idx").on(t.userId, t.createdAt)],
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
