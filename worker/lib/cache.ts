/**
 * Edge cache for the redirect hot path. Postgres stays the source of truth;
 * KV is a globally-replicated read cache so redirects rarely touch the DB.
 */
export interface CachedLink {
  id: string;
  destination: string;
  /** Per-OS deep-link targets; null = fall back to `destination`. */
  iosUrl: string | null;
  androidUrl: string | null;
  desktopUrl: string | null;
  isActive: boolean;
  /** epoch ms, or null when the link never expires */
  expiresAt: number | null;
}

/**
 * Pick the destination for a visitor's platform (Rebrandly-style device
 * routing): iOS / Android get their app/universal-link target, desktop its own;
 * anything unset falls back to the canonical `destination`. Done on the cached
 * payload so it stays on the edge hot path with no extra DB read.
 */
export function routeDestination(
  link: CachedLink,
  os: string | null,
  deviceType: string | null,
): string {
  if (os === "iOS" && link.iosUrl) return link.iosUrl;
  if (os === "Android" && link.androidUrl) return link.androidUrl;
  if (deviceType === "desktop" && link.desktopUrl) return link.desktopUrl;
  return link.destination;
}

const TTL_SECONDS = 60 * 60; // 1h backstop; we also invalidate on edit/delete
const key = (slug: string) => `link:${slug}`;

export async function getCachedLink(
  kv: KVNamespace,
  slug: string,
): Promise<CachedLink | null> {
  return kv.get<CachedLink>(key(slug), "json");
}

export async function putCachedLink(
  kv: KVNamespace,
  slug: string,
  value: CachedLink,
): Promise<void> {
  await kv.put(key(slug), JSON.stringify(value), { expirationTtl: TTL_SECONDS });
}

export async function deleteCachedLink(
  kv: KVNamespace,
  slug: string,
): Promise<void> {
  await kv.delete(key(slug));
}
