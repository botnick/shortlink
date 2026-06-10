// Shared DTOs between the Worker API and the React client.

import type { GameType, VerificationMode } from "./captcha";

export type Role = "user" | "admin";

export interface UserDTO {
  id: string;
  email: string;
  role: Role;
}

export type PreviewMode = "off" | "custom" | "destination";

export interface LinkDTO {
  id: string;
  slug: string;
  shortUrl: string;
  destination: string;
  /** Optional per-OS deep-link targets; null = use `destination`. */
  iosUrl: string | null;
  androidUrl: string | null;
  desktopUrl: string | null;
  isActive: boolean;
  expiresAt: string | null;
  clickCount: number;
  previewMode: PreviewMode;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  projectId: string | null;
  /** The custom domain id this back-half lives on, or null for the default host. */
  domainId: string | null;
  /** The hostname for `domainId` (e.g. go.brand.com), or null for the default host. */
  domain: string | null;
  /** true when a password gate is set (the password itself is never returned) */
  hasPassword: boolean;
  /** the saved QR design (a QrCfg), or null to use the default */
  qrConfig: Record<string, unknown> | null;
  /** free-form labels for organising/filtering */
  tags: string[];
  createdAt: string;
}

export interface LinkListDTO {
  links: LinkDTO[];
  nextCursor: string | null;
}

/** A retired back-half that still redirects to the link (edit history). */
export interface LinkAliasDTO {
  id: string;
  slug: string;
  domain: string | null;
  shortUrl: string;
  createdAt: string;
}

export interface LinkAliasListDTO {
  aliases: LinkAliasDTO[];
}

export interface BulkImportResultDTO {
  created: LinkDTO[];
  errors: { index: number; destination: string; reason: string }[];
}

/** One recent (human) click, for the live activity feed. */
export interface ActivityItemDTO {
  at: string;
  country: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  referrer: string | null;
}

export interface ActivityDTO {
  items: ActivityItemDTO[];
}

export interface ProjectDTO {
  id: string;
  name: string;
  /** Brand presets for this project — null inherits the global brand. */
  color: string | null;
  logo: string | null;
  /** Default custom domain for new links in this project (null = default host). */
  defaultDomainId: string | null;
  linkCount: number;
  isDefault: boolean;
  createdAt: string;
}

export interface ProjectListDTO {
  projects: ProjectDTO[];
  defaultProjectId: string;
}

export interface TimePoint {
  day: string;
  count: number;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface StatsWindows {
  last24h: number;
  last7d: number;
  last30d: number;
  allTime: number;
}

export interface StatsDTO {
  range: string;
  createdAt: string;
  totalClicks: number;
  uniqueVisitors: number;
  windows: StatsWindows;
  bestDay: { day: string; count: number } | null;
  directClicks: number;
  referrerClicks: number;
  /** Automated traffic (crawlers/monitors/CLIs) filtered out of the numbers above. */
  botClicks: number;
  timeseries: TimePoint[];
  countries: NameCount[];
  referrers: NameCount[];
  devices: NameCount[];
  browsers: NameCount[];
  os: NameCount[];
}

export interface AdminUserDTO {
  id: string;
  email: string;
  role: Role;
  isPrimary: boolean;
  createdAt: string;
  linkCount: number;
}

export interface AdminUserListDTO {
  users: AdminUserDTO[];
  nextCursor: string | null;
  total: number;
}

export interface AdminLinkDTO {
  id: string;
  slug: string;
  shortUrl: string;
  destination: string;
  isActive: boolean;
  clickCount: number;
  createdAt: string;
  ownerEmail: string;
  projectName: string | null;
  /** Custom domain hostname this link lives on, or null for the default host. */
  domain: string | null;
}

export interface AdminLinkListDTO {
  links: AdminLinkDTO[];
  nextCursor: string | null;
  total: number;
}

export interface AdminDomainDTO {
  id: string;
  hostname: string;
  status: string;
  ownerEmail: string;
  verifiedAt: string | null;
  createdAt: string;
}

export interface AdminDomainListDTO {
  domains: AdminDomainDTO[];
  nextCursor: string | null;
  total: number;
}

export interface AdminAnalyticsDTO {
  range: string;
  totalClicks: number;
  uniqueVisitors: number;
  timeseries: TimePoint[];
  countries: NameCount[];
  referrers: NameCount[];
  devices: NameCount[];
  browsers: NameCount[];
  os: NameCount[];
  topLinks: { slug: string; clickCount: number; ownerEmail: string }[];
}

export interface AdminOverviewDTO {
  totals: {
    links: number;
    clicks: number;
    users: number;
    activeLinks: number;
  };
  clicks7d: number;
  newLinks7d: number;
  topLinks: { slug: string; clickCount: number; ownerEmail: string }[];
  timeseries: TimePoint[];
  dbDriver: "postgres" | "sqlite";
}

/** One branded page's copy (heading + supporting line). */
export interface BrandPageCopy {
  heading: string;
  sub: string;
}

/**
 * Every editable string on the worker-served no-JS branded pages. Admin-settable
 * (one `brand_copy` object setting); defaults live in shared/defaults.ts. Nothing
 * is hardcoded in the renderers — they read from here.
 */
export interface BrandCopy {
  errors: {
    "not-found": BrandPageCopy;
    expired: BrandPageCopy;
    disabled: BrandPageCopy;
    "rate-limited": BrandPageCopy;
    error: BrandPageCopy;
  };
  password: { heading: string; sub: string; label: string; button: string };
  /** Link-safety interstitial (shown only when the admin enables it). */
  interstitial: { heading: string; sub: string; leaving: string; continue: string };
  /** Label of the "go home" button on the error pages. */
  homeCta: string;
  /** Optional support link shown in the footer (blank url = hidden). */
  support: { label: string; url: string };
}

export interface SettingsDTO {
  registrationEnabled: boolean;
  appName: string;
  shortDomain: string;
  brandColor: string;
  logoUrl: string;
  description: string;
  ogImageUrl: string;
  indexable: boolean;
  blockedDomains: string[];
  extraReserved: string[];
  maxLinksPerUser: number;
  /** Abuse limits (0 = disabled). */
  authRateLimit: number;
  createRateLimit: number;
  maxDomainsPerUser: number;
  maxAliasesPerLink: number;
  /** Public API (bearer keys). */
  apiEnabled: boolean;
  apiRateLimit: number;
  maxApiKeysPerUser: number;
  /** MCP server for AI agents (rides under the API master switch). */
  mcpEnabled: boolean;
  /** Length of auto-generated back-halves (3–32). */
  slugLength: number;
  /** Closed accounts: days held before purge, then extra days the email stays blocked. */
  accountHoldDays: number;
  emailBlockDays: number;
  /** Human check (sign-in & sign-up): disabled | invisible | game-only | forced-game. */
  challengeMode: VerificationMode;
  /** Proof-of-work difficulty in bits (0 = off, ~18–20 recommended). */
  powDifficulty: number;
  /** Human check v3 — every knob of the interactive game CAPTCHA. */
  captchaGames: GameType[];
  captchaMinGames: number;
  captchaMaxGames: number;
  captchaChallengeTtl: number;
  captchaTokenTtl: number;
  captchaMaxRetries: number;
  captchaMaxEvents: number;
  captchaRiskMedium: number;
  captchaRiskHigh: number;
  captchaTolerance: "lenient" | "standard" | "strict";
  captchaCreateLimit: number;
  captchaVerifyLimit: number;
  /** Enforce the risk block, or run in shadow mode (log-only) to tune. */
  captchaEnforce: boolean;
  /** Cloudflare for SaaS — configured via /admin. The token is never returned;
   *  `cfConfigured` reflects whether a token + zone id are set. */
  cfZoneId: string;
  cfFallbackHost: string;
  cfConfigured: boolean;
  ogTemplate: string;
  ogFont: string;
  // Social-card identity (raw overrides; blank = inherit the branding value).
  ogLabel: string;
  ogTitle: string;
  ogTagline: string;
  ogAccent: string;
  domainUnverifiedDays: number;
  /** Days of raw click rows to keep (0 = forever); a cron purges older ones. */
  clicksRetentionDays: number;
  /** Editable copy for the worker-served branded pages. */
  brandCopy: BrandCopy;
  /** Show a "you're leaving to …" interstitial before redirecting. */
  safetyInterstitial: boolean;
}

export interface AppConfigDTO {
  needsSetup: boolean;
  appName: string;
  /** Display host for short links (admin setting, falling back to the app host). */
  shortDomain: string;
  /** Canonical public origin (from APP_URL) — for docs/display, never localhost. */
  appOrigin: string;
  brandColor: string;
  logoUrl: string;
  description: string;
  indexable: boolean;
  registrationEnabled: boolean;
  ogTemplate: string;
  ogFont: string;
  // Social-card identity, resolved (override or branding fallback) for rendering.
  ogLabel: string;
  ogTitle: string;
  ogTagline: string;
  ogAccent: string;
  domainUnverifiedDays: number;
  /** Whether the public (bearer-key) API is enabled. */
  apiEnabled: boolean;
  /** Whether the MCP server (AI agents) is enabled. */
  mcpEnabled: boolean;
  /** Length of auto-generated back-halves. */
  slugLength: number;
  /** Human check on sign-in/sign-up: disabled | invisible (silent, escalates
   *  to a game when unsure) | game-only (always one game) | forced-game
   *  (always games; risk tunes difficulty/count). */
  challengeMode: VerificationMode;
  /** Proof-of-work difficulty in bits backing the human check. */
  powDifficulty: number;
  /** Editable copy for the worker-served branded pages. */
  brandCopy: BrandCopy;
  /** Show a "you're leaving to …" interstitial before redirecting. */
  safetyInterstitial: boolean;
}

/** A destination URL's own metadata, for the rich link-preview card. */
export interface UrlMetaDTO {
  title: string;
  description: string;
  image: string;
  siteName: string;
  favicon: string;
  domain: string;
}

export interface QrPresetDTO {
  id: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface AssetDTO {
  id: string;
  name: string;
  url: string;
}

export interface DomainDnsRecord {
  type: string; // "CNAME" | "TXT"
  name: string;
  value: string;
}

export interface DomainDTO {
  id: string;
  hostname: string;
  status: string; // "pending" | "verified" | "active"
  mode: "dns" | "saas";
  records: DomainDnsRecord[];
  verifiedAt: string | null;
  createdAt: string;
}

export interface DomainListDTO {
  mode: "dns" | "saas";
  domains: DomainDTO[];
}

/** A programmatic access token (the key itself is only returned at creation). */
export interface ApiKeyDTO {
  id: string;
  name: string;
  /** First characters of the key (e.g. "sk_ab12cd34") for identification. */
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiKeyListDTO {
  keys: ApiKeyDTO[];
}

export interface ApiKeyCreatedDTO {
  /** The full secret — shown exactly once; only a hash is stored. */
  key: string;
  apiKey: ApiKeyDTO;
}

/** One signed-in device on the account page (`id` is a safe public id). */
export interface SessionDTO {
  id: string;
  current: boolean;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  country: string | null;
  lastActiveAt: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionListDTO {
  sessions: SessionDTO[];
}

export interface ApiError {
  error: string;
}
