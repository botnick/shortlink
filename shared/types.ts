// Shared DTOs between the Worker API and the React client.

export type Role = "user" | "admin";

export interface UserDTO {
  id: string;
  email: string;
  role: Role;
}

export interface LinkDTO {
  id: string;
  slug: string;
  shortUrl: string;
  destination: string;
  title: string | null;
  isActive: boolean;
  expiresAt: string | null;
  clickCount: number;
  createdAt: string;
}

export interface LinkListDTO {
  links: LinkDTO[];
  nextCursor: string | null;
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

export interface SettingsDTO {
  registrationEnabled: boolean;
  appName: string;
  shortDomain: string;
  brandColor: string;
  logoUrl: string;
  description: string;
  ogImageUrl: string;
  indexable: boolean;
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

export interface ApiError {
  error: string;
}
