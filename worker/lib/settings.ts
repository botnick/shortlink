import { count, eq } from "drizzle-orm";
import type { DB, DbSchema } from "../db";
import type { AppConfigDTO, BrandCopy } from "@shared/types";
import {
  POOL_GAME_TYPES,
  type GameType,
  type VerificationMode,
} from "@shared/captcha";
import {
  DEFAULT_APP_NAME,
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_COPY,
  DEFAULT_OG_FONT,
  DEFAULT_OG_TEMPLATE,
} from "@shared/defaults";

export const SETTING_KEYS = {
  registration: "registration_enabled",
  appName: "app_name",
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
  accountHoldDays: "account_hold_days",
  emailBlockDays: "email_block_days",
  powDifficulty: "pow_difficulty",
  challengeMode: "challenge_mode",
  captchaGames: "captcha_games",
  captchaMinGames: "captcha_min_games",
  captchaMaxGames: "captcha_max_games",
  captchaChallengeTtl: "captcha_challenge_ttl",
  captchaTokenTtl: "captcha_token_ttl",
  captchaMaxRetries: "captcha_max_retries",
  captchaMaxEvents: "captcha_max_events",
  captchaRiskMedium: "captcha_risk_medium",
  captchaRiskHigh: "captcha_risk_high",
  captchaTolerance: "captcha_tolerance",
  captchaCreateLimit: "captcha_create_limit",
  captchaVerifyLimit: "captcha_verify_limit",
  captchaEnforce: "captcha_enforce",
  cfApiToken: "cf_api_token",
  cfZoneId: "cf_zone_id",
  cfFallbackHost: "cf_fallback_host",
  domainUnverifiedDays: "domain_unverified_days",
  clicksRetentionDays: "clicks_retention_days",
  ogTemplate: "og_template",
  ogFont: "og_font",
  ogLabel: "og_label",
  ogTitle: "og_title",
  ogTagline: "og_tagline",
  ogAccent: "og_accent",
  brandCopy: "brand_copy",
  safetyInterstitial: "safety_interstitial",
  setupCompleted: "setup_completed",
} as const;

export async function getAllSettings(
  db: DB,
  schema: DbSchema,
): Promise<Record<string, unknown>> {
  const rows = await db.select().from(schema.settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// In-isolate memo of the settings map for HOT, latency-sensitive read paths
// (the human-check challenge mint runs an INSERT already; skipping the settings
// SELECT halves its DB round-trips). Short TTL so an admin save takes effect
// quickly; setSetting clears it immediately within the same isolate.
let settingsMemo: { map: Record<string, unknown>; until: number } | null = null;
const SETTINGS_MEMO_MS = 8000;

export async function getCachedSettings(
  db: DB,
  schema: DbSchema,
): Promise<Record<string, unknown>> {
  if (settingsMemo && settingsMemo.until > Date.now()) return settingsMemo.map;
  const map = await getAllSettings(db, schema);
  settingsMemo = { map, until: Date.now() + SETTINGS_MEMO_MS };
  return map;
}

/** Drop the memo (called after any write so reads don't serve a stale map). */
export function resetSettingsCache(): void {
  settingsMemo = null;
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
  resetSettingsCache(); // never serve the just-overwritten value from the memo
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

export function safetyInterstitialFrom(map: Record<string, unknown>): boolean {
  return map[SETTING_KEYS.safetyInterstitial] === true; // default: off
}

/**
 * Resolve the editable brand-page copy: a stored partial override DEEP-MERGED
 * onto DEFAULT_BRAND_COPY, field by field. So an admin can override just one
 * string, missing/new fields always fall back to the centralised default, and a
 * malformed stored value degrades to all defaults. Nothing hardcoded here — the
 * literals live in shared/defaults.ts.
 */
export function brandCopyFrom(map: Record<string, unknown>): BrandCopy {
  const v = map[SETTING_KEYS.brandCopy];
  const o = (typeof v === "object" && v !== null && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_BRAND_COPY;
  // Blank / whitespace-only → use the default, so clearing a field in the admin
  // form and saving reverts it to the default instead of rendering empty.
  const pick = (x: unknown, fb: string): string =>
    typeof x === "string" && x.trim() !== "" ? x : fb;
  const sub = (k: string): Record<string, unknown> => {
    const x = o[k];
    return typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
  };
  const errIn = sub("errors");
  const oneErr = (k: keyof BrandCopy["errors"]) => {
    const e = typeof errIn[k] === "object" && errIn[k] !== null ? (errIn[k] as Record<string, unknown>) : {};
    return { heading: pick(e.heading, d.errors[k].heading), sub: pick(e.sub, d.errors[k].sub) };
  };
  const pw = sub("password");
  const it = sub("interstitial");
  const sp = sub("support");
  return {
    errors: {
      "not-found": oneErr("not-found"),
      expired: oneErr("expired"),
      disabled: oneErr("disabled"),
      "rate-limited": oneErr("rate-limited"),
      error: oneErr("error"),
    },
    password: {
      heading: pick(pw.heading, d.password.heading),
      sub: pick(pw.sub, d.password.sub),
      label: pick(pw.label, d.password.label),
      button: pick(pw.button, d.password.button),
    },
    interstitial: {
      heading: pick(it.heading, d.interstitial.heading),
      sub: pick(it.sub, d.interstitial.sub),
      leaving: pick(it.leaving, d.interstitial.leaving),
      continue: pick(it.continue, d.interstitial.continue),
    },
    homeCta: pick(o.homeCta, d.homeCta),
    // Support is hidden by default (blank), so a blank here correctly stays blank.
    support: { label: pick(sp.label, d.support.label), url: pick(sp.url, d.support.url) },
  };
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

/** Days of raw click rows to keep; a daily cron purges older ones to bound the
 *  clicks table (the only table that grows with traffic). 0 = keep forever.
 *  All-time totals survive purges via the denormalized links.click_count. */
export function clicksRetentionDaysFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.clicksRetentionDays], 0);
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

/** Days a closed account is held (soft-deleted) before the cron purges it. */
export function accountHoldDaysFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.accountHoldDays], 180);
}

/** Days after the purge during which the email still can't register again. */
export function emailBlockDaysFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.emailBlockDays], 180);
}

/** Sign-up bot deterrence: leading zero bits the browser's proof-of-work hash
 *  must have. 0 disables. The base is deliberately modest (≈65k hashes ≈ tens
 *  of ms in the Web Worker solver) so a real user — who never fails — barely
 *  waits; every failed attempt escalates this by +1 bit (×2 cost) per the
 *  adaptive layer, so grinding bots are the ones that pay. Self-hosted by
 *  design — no third-party challenge service. */
export function powDifficultyFrom(map: Record<string, unknown>): number {
  const v = map[SETTING_KEYS.powDifficulty];
  const n = typeof v === "number" ? Math.floor(v) : 16;
  return Math.min(26, Math.max(0, n));
}

export type ChallengeMode = VerificationMode;

/** Human check on sign-in AND sign-up. v3 modes, with the v2 values that may
 *  still sit in the settings table mapped onto them (off→disabled,
 *  game→game-only) so existing installs keep their behavior untouched. */
export function challengeModeFrom(map: Record<string, unknown>): VerificationMode {
  const v = map[SETTING_KEYS.challengeMode];
  if (v === "off") return "disabled"; // legacy v2 value
  if (v === "game" || v === "forced-game") return "game-only"; // legacy values
  if (v === "disabled" || v === "invisible" || v === "game-only") return v;
  return "game-only";
}

// --- Human check v3 (interactive game CAPTCHA) --------------------------------
// Every knob is an admin setting; nothing about the check is hardcoded.

// The default-on pool: the three games a person understands at a glance — tap
// one shape, drag one shape into a ring, trace numbered dots. The more
// cognitive games (rotate / connect-the-pair / sort-by-size) ship implemented
// but OFF, so an admin can opt in without us starting anyone on a harder puzzle.
const DEFAULT_GAMES: GameType[] = ["slide", "tap-match", "drag-target", "path-trace"];

/** Which VISUAL games the pool may serve. Unknown/non-pool entries (e.g. the
 *  accessible `key-count`, which is never in the rotation) are dropped; an empty
 *  or missing list falls back to the simple default set. */
export function captchaGamesFrom(map: Record<string, unknown>): GameType[] {
  const v = map[SETTING_KEYS.captchaGames];
  const valid = Array.isArray(v)
    ? (v.filter(
        (g): g is GameType =>
          typeof g === "string" && (POOL_GAME_TYPES as readonly string[]).includes(g),
      ) as GameType[])
    : [];
  return valid.length > 0 ? valid : [...DEFAULT_GAMES];
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Games per challenge in forced-game mode (floor; risk can add up to max). */
export function captchaMinGamesFrom(map: Record<string, unknown>): number {
  return clampInt(map[SETTING_KEYS.captchaMinGames], 1, 1, 3);
}

export function captchaMaxGamesFrom(map: Record<string, unknown>): number {
  const min = captchaMinGamesFrom(map);
  return clampInt(map[SETTING_KEYS.captchaMaxGames], Math.max(2, min), min, 3);
}

/** Seconds a challenge stays playable. Short on purpose — staleness is a core
 *  screenshot/replay defense. */
export function captchaChallengeTtlFrom(map: Record<string, unknown>): number {
  return clampInt(map[SETTING_KEYS.captchaChallengeTtl], 120, 30, 600);
}

/** Seconds a verification token stays redeemable (single-use either way). */
export function captchaTokenTtlFrom(map: Record<string, unknown>): number {
  return clampInt(map[SETTING_KEYS.captchaTokenTtl], 300, 60, 900);
}

/** Wrong-answer retries before a challenge locks (each retry = fresh layout). */
export function captchaMaxRetriesFrom(map: Record<string, unknown>): number {
  return clampInt(map[SETTING_KEYS.captchaMaxRetries], 3, 1, 10);
}

/** Interaction events accepted per submit (cost + flooding cap). */
export function captchaMaxEventsFrom(map: Record<string, unknown>): number {
  return clampInt(map[SETTING_KEYS.captchaMaxEvents], 300, 50, 1000);
}

/** Risk score from which a submit gets logged for review. */
export function captchaRiskMediumFrom(map: Record<string, unknown>): number {
  return clampInt(map[SETTING_KEYS.captchaRiskMedium], 30, 1, 100);
}

/** Risk score from which a submit is rejected (counts as a failed attempt). */
export function captchaRiskHighFrom(map: Record<string, unknown>): number {
  return clampInt(map[SETTING_KEYS.captchaRiskHigh], 60, 1, 100);
}

export type CaptchaTolerance = "lenient" | "standard" | "strict";

/** Geometry forgiveness for shaky hands / coarse touch. */
export function captchaToleranceFrom(
  map: Record<string, unknown>,
): CaptchaTolerance {
  const v = map[SETTING_KEYS.captchaTolerance];
  return v === "lenient" || v === "strict" ? v : "standard";
}

const TOLERANCE_MULT: Record<CaptchaTolerance, number> = {
  lenient: 1.3,
  standard: 1.0,
  strict: 0.8,
};

/** Challenge mints allowed per IP per minute (0 = unlimited). */
export function captchaCreateLimitFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.captchaCreateLimit], 10);
}

/** Verify submits allowed per IP per minute (0 = unlimited). */
export function captchaVerifyLimitFrom(map: Record<string, unknown>): number {
  return asCount(map[SETTING_KEYS.captchaVerifyLimit], 30);
}

/** Enforce the risk score, or run in SHADOW mode. Default on (enforce). When
 *  off, a high risk score is logged but never blocks — so an admin can watch the
 *  numbers on real traffic and tune the thresholds before turning on blocking,
 *  which is how you keep false-positives at zero. The game itself is still
 *  required either way (shadow disables only the behavioral-risk block). */
export function captchaEnforceFrom(map: Record<string, unknown>): boolean {
  return map[SETTING_KEYS.captchaEnforce] !== false;
}

/** Everything the challenge engine needs, resolved in one place. */
export interface CaptchaConfig {
  mode: VerificationMode;
  games: GameType[];
  minGames: number;
  maxGames: number;
  challengeTtlSec: number;
  tokenTtlSec: number;
  maxRetries: number;
  maxEvents: number;
  riskMedium: number;
  riskHigh: number;
  toleranceMult: number;
  createLimit: number;
  verifyLimit: number;
  enforce: boolean;
}

export function captchaConfigFrom(map: Record<string, unknown>): CaptchaConfig {
  return {
    mode: challengeModeFrom(map),
    games: captchaGamesFrom(map),
    minGames: captchaMinGamesFrom(map),
    maxGames: captchaMaxGamesFrom(map),
    challengeTtlSec: captchaChallengeTtlFrom(map),
    tokenTtlSec: captchaTokenTtlFrom(map),
    maxRetries: captchaMaxRetriesFrom(map),
    maxEvents: captchaMaxEventsFrom(map),
    riskMedium: captchaRiskMediumFrom(map),
    riskHigh: captchaRiskHighFrom(map),
    toleranceMult: TOLERANCE_MULT[captchaToleranceFrom(map)],
    createLimit: captchaCreateLimitFrom(map),
    verifyLimit: captchaVerifyLimitFrom(map),
    enforce: captchaEnforceFrom(map),
  };
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

  // The canonical public origin for display and docs comes from APP_URL — the
  // single source of truth, set at deploy alongside the Worker route. (Never a
  // dev host; the client only ever displays this server-provided origin.)
  const appOrigin = appUrl.replace(/\/+$/, "");
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
    shortDomain: appHost,
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
    // Human check (sign-in & sign-up): mode + proof-of-work difficulty.
    challengeMode: challengeModeFrom(map),
    powDifficulty: powDifficultyFrom(map),
    brandCopy: brandCopyFrom(map),
    safetyInterstitial: safetyInterstitialFrom(map),
  };
}
