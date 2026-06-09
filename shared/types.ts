// Shared DTOs between the Worker API and the React client.

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
  title: string | null;
  isActive: boolean;
  expiresAt: string | null;
  clickCount: number;
  previewMode: PreviewMode;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  projectId: string | null;
  /** true when a password gate is set (the password itself is never returned) */
  hasPassword: boolean;
  /** the saved QR design (a QrCfg), or null to use the default */
  qrConfig: Record<string, unknown> | null;
  createdAt: string;
}

export interface LinkListDTO {
  links: LinkDTO[];
  nextCursor: string | null;
}

export interface ProjectDTO {
  id: string;
  name: string;
  /** Brand presets for this project — null inherits the global brand. */
  color: string | null;
  logo: string | null;
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
  title: string | null;
  isActive: boolean;
  clickCount: number;
  createdAt: string;
  ownerEmail: string;
  projectName: string | null;
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
}

export interface AppConfigDTO {
  needsSetup: boolean;
  appName: string;
  shortDomain: string;
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

export interface ApiError {
  error: string;
}
