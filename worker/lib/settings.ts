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
  cfApiToken: "cf_api_token",
  cfZoneId: "cf_zone_id",
  cfFallbackHost: "cf_fallback_host",
  ogTemplate: "og_template",
  ogFont: "og_font",
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

const OG_TEMPLATE_IDS = [
  "minimal",
  "dark",
  "brand",
  "split",
  "grid",
  "editorial",
  "glow",
  "sidebar",
  "footer",
  "frame",
  "card",
  "mono",
];
export function ogTemplateFrom(map: Record<string, unknown>): string {
  const v = map[SETTING_KEYS.ogTemplate];
  return typeof v === "string" && OG_TEMPLATE_IDS.includes(v) ? v : "minimal";
}

const OG_FONT_IDS = [
  "ibm-plex-thai",
  "ibm-plex-thai-looped",
  "kanit",
  "noto-sans-thai",
  "sarabun",
];
export function ogFontFrom(map: Record<string, unknown>): string {
  const v = map[SETTING_KEYS.ogFont];
  return typeof v === "string" && OG_FONT_IDS.includes(v) ? v : "ibm-plex-thai";
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

export interface SaasConfig {
  token: string;
  zoneId: string;
  fallbackHost: string;
}

/** Cloudflare-for-SaaS config, read from settings (configured via /admin — no
 *  env vars). Returns null unless a token + zone id are present. Fallback host
 *  defaults to the app's own host. */
export function saasConfigFrom(
  map: Record<string, unknown>,
  appUrl: string,
): SaasConfig | null {
  const token = asString(map[SETTING_KEYS.cfApiToken], "");
  const zoneId = asString(map[SETTING_KEYS.cfZoneId], "");
  if (!token || !zoneId) return null;
  let fallbackHost = asString(map[SETTING_KEYS.cfFallbackHost], "");
  if (!fallbackHost) {
    try {
      fallbackHost = new URL(appUrl).host;
    } catch {
      fallbackHost = "";
    }
  }
  return { token, zoneId, fallbackHost };
}

export function cfZoneIdFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.cfZoneId], "");
}

export function cfFallbackHostFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.cfFallbackHost], "");
}

export function cfConfiguredFrom(map: Record<string, unknown>): boolean {
  return Boolean(
    asString(map[SETTING_KEYS.cfApiToken], "") &&
      asString(map[SETTING_KEYS.cfZoneId], ""),
  );
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
    ogTemplate: ogTemplateFrom(map),
    ogFont: ogFontFrom(map),
  };
}
