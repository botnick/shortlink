import { count, eq } from "drizzle-orm";
import { settings, users } from "../db/schema";
import type { DB } from "../db";
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
  setupCompleted: "setup_completed",
} as const;

const DEFAULT_APP_NAME = "Shortlink";
const DEFAULT_BRAND_COLOR = "#e5392e";

export async function getAllSettings(db: DB): Promise<Record<string, unknown>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(
  db: DB,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function getRegistrationEnabled(db: DB): Promise<boolean> {
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

/** Public, unauthenticated app config used by the SPA at startup. */
export async function getPublicConfig(db: DB): Promise<AppConfigDTO> {
  const map = await getAllSettings(db);

  let needsSetup = map[SETTING_KEYS.setupCompleted] !== true;
  if (needsSetup) {
    const [row] = await db.select({ c: count() }).from(users);
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
