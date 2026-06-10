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
  /** true when the link is password-gated (the hash itself stays in the DB) */
  hasPassword: boolean;
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

// 24h backstop only — correctness comes from explicit invalidation on every
// edit/delete (refreshLinkCache/purgeLinkCache), and expiry/active/password are
// re-evaluated from the payload at request time. A long TTL keeps the lazy
// re-fill from rewriting hot entries hourly (which would eat the KV write cap).
const TTL_SECONDS = 60 * 60 * 24;

// The cache key is scoped by domain so the same slug can live on more than one
// host (per-domain custom back-halves). `null` = the default short host bucket.
const key = (domainId: string | null, slug: string) =>
  `link:${domainId ?? "_"}:${slug}`;

export async function getCachedLink(
  kv: KVNamespace,
  domainId: string | null,
  slug: string,
): Promise<CachedLink | null> {
  try {
    return await kv.get<CachedLink>(key(domainId, slug), "json");
  } catch {
    // KV unavailable / over its read quota → treat as a miss so the caller
    // falls through to the database (the source of truth) instead of 500ing.
    return null;
  }
}

export async function putCachedLink(
  kv: KVNamespace,
  domainId: string | null,
  slug: string,
  value: CachedLink,
): Promise<void> {
  try {
    await kv.put(key(domainId, slug), JSON.stringify(value), {
      expirationTtl: TTL_SECONDS,
    });
  } catch {
    // KV write blip / over quota — the cache just stays cold; the DB still
    // serves. Never let a cache-warm failure surface to the visitor.
  }
}

export async function deleteCachedLink(
  kv: KVNamespace,
  domainId: string | null,
  slug: string,
): Promise<void> {
  await kv.delete(key(domainId, slug));
}
