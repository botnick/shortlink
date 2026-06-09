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

export const userRole = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    role: userRole().notNull().default("user"),
    isPrimary: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
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
    title: text(),
    isActive: boolean().notNull().default(true),
    expiresAt: timestamp({ withTimezone: true }),
    clickCount: integer().notNull().default(0),
    // Social preview: "off" (plain redirect) | "custom" | "destination".
    previewMode: text().notNull().default("off"),
    ogTitle: text(),
    ogDescription: text(),
    ogImage: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("links_slug_idx").on(t.slug),
    index("links_user_created_idx").on(t.userId, t.createdAt),
    index("links_project_created_idx").on(t.projectId, t.createdAt),
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
  },
  (t) => [index("clicks_link_created_idx").on(t.linkId, t.createdAt)],
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
  ],
);

export type UserRow = typeof users.$inferSelect;
export type LinkRow = typeof links.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ClickRow = typeof clicks.$inferSelect;
export type QrPresetRow = typeof qrPresets.$inferSelect;
export type DomainRow = typeof domains.$inferSelect;
