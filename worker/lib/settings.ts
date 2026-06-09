import { count, eq } from "drizzle-orm";
import type { DB, DbSchema } from "../db";
import type { AppConfigDTO } from "@shared/types";
import {
  DEFAULT_APP_NAME,
  DEFAULT_BRAND_COLOR,
  DEFAULT_OG_FONT,
  DEFAULT_OG_TEMPLATE,
} from "@shared/defaults";

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
  authRateLimit: "auth_rate_limit",
  createRateLimit: "create_rate_limit",
  maxDomainsPerUser: "max_domains_per_user",
  maxAliasesPerLink: "max_aliases_per_link",
  apiEnabled: "api_enabled",
  apiRateLimit: "api_rate_limit",
  maxApiKeysPerUser: "max_api_keys_per_user",
  mcpEnabled: "mcp_enabled",
  slugLength: "slug_length",
  cfApiToken: "cf_api_token",
  cfZoneId: "cf_zone_id",
  cfFallbackHost: "cf_fallback_host",
  domainUnverifiedDays: "domain_unverified_days",
  ogTemplate: "og_template",
  ogFont: "og_font",
  ogLabel: "og_label",
  ogTitle: "og_title",
  ogTagline: "og_tagline",
  ogAccent: "og_accent",
  setupCompleted: "setup_completed",
} as const;

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
  return typeof v === "string" && OG_TEMPLATE_IDS.includes(v) ? v : DEFAULT_OG_TEMPLATE;
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
  return typeof v === "string" && OG_FONT_IDS.includes(v) ? v : DEFAULT_OG_FONT;
}

// Social-card identity — configured independently of branding, but each falls
// back to the matching branding value when left blank (raw getters expose the
// stored override for the admin form; the *From getters resolve the fallback).
export function ogLabelRawFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.ogLabel], "");
}
export function ogTitleRawFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.ogTitle], "");
}
export function ogTaglineRawFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.ogTagline], "");
}
export function ogAccentRawFrom(map: Record<string, unknown>): string {
  return asString(map[SETTING_KEYS.ogAccent], "");
}
export function ogLabelFrom(map: Record<string, unknown>): string {
  return ogLabelRawFrom(map) || appNameFrom(map);
}
export function ogTitleFrom(map: Record<string, unknown>): string {
  return ogTitleRawFrom(map) || appNameFrom(map);
}
export function ogTaglineFrom(map: Record<string, unknown>): string {
  return ogTaglineRawFrom(map) || descriptionFrom(map);
}
export function ogAccentFrom(map: Record<string, unknown>): string {
  const v = ogAccentRawFrom(map);
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : brandColorFrom(map);
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

/** A non-negative integer setting with a default (and a 0-allowed floor). */
function asCount(value: unknown, fallback: number): number {
  return typeof value === "number" && value >= 0 ? Math.floor(value) : fallback;
}

// --- Abuse limits (all admin-configurable; 0 disables the limit) -------------

/** Login/registration attempts allowed per IP per 15-minute window. */
export function authRateLimitFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.authRateLimit], 10);
}

/** New links a single user may create per hour. */
export function createRateLimitFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.createRateLimit], 60);
}

/** Custom domains a single user may add. */
export function maxDomainsPerUserFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.maxDomainsPerUser], 10);
}

/** How many times a link's back-half may be changed (each change retires the old
 *  one to a still-working alias). 0 = unlimited. */
export function maxAliasesPerLinkFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.maxAliasesPerLink], 5);
}

// --- Public API (all admin-configurable) -------------------------------------

/** Master switch for the public API (bearer keys). Default: on. */
export function apiEnabledFrom(map: Record<string, unknown>): boolean {
  return map[SETTING_KEYS.apiEnabled] !== false;
}

/** Public-API requests allowed per key per minute. 0 = unlimited. */
export function apiRateLimitFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.apiRateLimit], 120);
}

/** API keys a single member may hold. 0 = unlimited. */
export function maxApiKeysPerUserFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.maxApiKeysPerUser], 10);
}

/** MCP server (AI-agent transport) — rides under the public-API master switch. */
export function mcpEnabledFrom(map: Record<string, unknown>): boolean {
  return map[SETTING_KEYS.mcpEnabled] !== false;
}

/** Length of auto-generated back-halves (server defaults + editor suggestions),
 *  clamped to the slug rules (3–32). */
export function slugLengthFrom(map: Record<string, unknown>): number {
  const v = map[SETTING_KEYS.slugLength];
  const n = typeof v === "number" ? Math.floor(v) : 6;
  return Math.min(32, Math.max(3, n));
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

/** Days an unverified custom domain is kept before the cron removes it.
 *  Default 90; 0 disables auto-removal. */
export function domainUnverifiedDaysFrom(map: Record<string, unknown>): number {
  const v = map[SETTING_KEYS.domainUnverifiedDays];
  return typeof v === "number" && v >= 0 ? Math.floor(v) : 90;
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
  appUrl: string,
): Promise<AppConfigDTO> {
  const map = await getAllSettings(db, schema);

  let needsSetup = map[SETTING_KEYS.setupCompleted] !== true;
  if (needsSetup) {
    const [row] = await db.select({ c: count() }).from(schema.users);
    needsSetup = Number(row?.c ?? 0) === 0;
  }

  // The canonical public origin for display and docs. The admin's Short domain
  // is the source of truth (every connected host serves this same Worker);
  // APP_URL is only the fallback before it's configured. Never a dev host.
  const configuredHost = shortDomainFrom(map)
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/.*$/, "");
  const appOrigin = configuredHost
    ? `https://${configuredHost}`
    : appUrl.replace(/\/+$/, "");
  let appHost = "";
  try {
    appHost = new URL(appOrigin).host;
  } catch {
    appHost = "";
  }

  return {
    needsSetup,
    appName: appNameFrom(map),
    // Display host for short links: the admin setting, else the app's own host.
    shortDomain: configuredHost || appHost,
    appOrigin,
    brandColor: brandColorFrom(map),
    logoUrl: logoFrom(map),
    description: descriptionFrom(map),
    indexable: indexableFrom(map),
    registrationEnabled: map[SETTING_KEYS.registration] === true,
    ogTemplate: ogTemplateFrom(map),
    ogFont: ogFontFrom(map),
    ogLabel: ogLabelFrom(map),
    ogTitle: ogTitleFrom(map),
    ogTagline: ogTaglineFrom(map),
    ogAccent: ogAccentFrom(map),
    domainUnverifiedDays: domainUnverifiedDaysFrom(map),
    apiEnabled: apiEnabledFrom(map),
    mcpEnabled: mcpEnabledFrom(map),
    slugLength: slugLengthFrom(map),
  };
}
