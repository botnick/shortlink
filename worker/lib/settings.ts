import { count, eq } from "drizzle-orm";
import type { DB, DbSchema } from "../db";
import type { AppConfigDTO } from "@shared/types";

export const SETTING_KEYS = {
  registration: "registration_enabled",
  appName: "app_name",
  shortDomain: "short_domain",
  brandColor: "brand_color",
  logo: "logo_url",
  description: "description",
  ogImage: "og_image_url",
  indexable: "indexable",
  blockedDomains: "blocked_domains",
  extraReserved: "extra_reserved_slugs",
  maxLinksPerUser: "max_links_per_user",
  setupCompleted: "setup_completed",
} as const;

const DEFAULT_APP_NAME = "Shortlink";
const DEFAULT_BRAND_COLOR = "#e5392e";

export async function getAllSettings(
  db: DB,
  schema: DbSchema,
): Promise<Record<string, unknown>> {
  const rows = await db.select().from(schema.settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(
  db: DB,
  schema: DbSchema,
  key: string,
  value: unknown,
): Promise<void> {
  const { settings } = schema;
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function getRegistrationEnabled(
  db: DB,
  schema: DbSchema,
): Promise<boolean> {
  const { settings } = schema;
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SETTING_KEYS.registration))
    .limit(1);
  return rows[0]?.value === true;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function appNameFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.appName], DEFAULT_APP_NAME);
}

export function shortDomainFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.shortDomain], "");
}

export function brandColorFrom(map: Record<string, unknown>): string {
  const v = map[SETTING_KEYS.brandColor];
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)
    ? v
    : DEFAULT_BRAND_COLOR;
}

export function logoFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.logo], "");
}

export function descriptionFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.description], "");
}

export function ogImageFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.ogImage], "");
}

export function indexableFrom(map: Record<string, unknown>): boolean {
  return map[SETTING_KEYS.indexable] !== false; // default: indexable
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export function blockedDomainsFrom(map: Record<string, unknown>): string[] {
  return asStringArray(map[SETTING_KEYS.blockedDomains]);
}

export function extraReservedFrom(map: Record<string, unknown>): string[] {
  return asStringArray(map[SETTING_KEYS.extraReserved]);
}

export function maxLinksPerUserFrom(map: Record<string, unknown>): number {
  const v = map[SETTING_KEYS.maxLinksPerUser];
  return typeof v === "number" && v > 0 ? Math.floor(v) : 0; // 0 = unlimited
}

/** True if `destination`'s host is on the blocked list (exact or subdomain). */
export function isBlockedDestination(
  destination: string,
  blocked: string[],
): boolean {
  if (blocked.length === 0) return false;
  let host: string;
  try {
    host = new URL(destination).hostname.toLowerCase();
  } catch {
    return false;
  }
  return blocked.some((d) => {
    const dom = d.trim().toLowerCase().replace(/^\*?\.?/, "");
    return dom !== "" && (host === dom || host.endsWith(`.${dom}`));
  });
}

/** Public, unauthenticated app config used by the SPA at startup. */
export async function getPublicConfig(
  db: DB,
  schema: DbSchema,
): Promise<AppConfigDTO> {
  const map = await getAllSettings(db, schema);

  let needsSetup = map[SETTING_KEYS.setupCompleted] !== true;
  if (needsSetup) {
    const [row] = await db.select({ c: count() }).from(schema.users);
    needsSetup = Number(row?.c ?? 0) === 0;
  }

  return {
    needsSetup,
    appName: appNameFrom(map),
    shortDomain: shortDomainFrom(map),
    brandColor: brandColorFrom(map),
    logoUrl: logoFrom(map),
    description: descriptionFrom(map),
    indexable: indexableFrom(map),
    registrationEnabled: map[SETTING_KEYS.registration] === true,
  };
}
