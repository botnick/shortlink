/**
 * Edge cache for the redirect hot path. Postgres stays the source of truth;
 * KV is a globally-replicated read cache so redirects rarely touch the DB.
 */
import type { GeoRule } from "@shared/types";

export interface CachedLink {
  id: string;
  destination: string;
  /** Per-OS deep-link targets; null = fall back to `destination`. */
  iosUrl: string | null;
  androidUrl: string | null;
  desktopUrl: string | null;
  /** Per-country redirect overrides; absent on links cached before this shipped. */
  geoRules?: GeoRule[] | null;
  isActive: boolean;
  /** true when the link is password-gated (the hash itself stays in the DB) */
  hasPassword: boolean;
  /** epoch ms, or null when the link never expires */
  expiresAt: number | null;
}

/**
 * Pick the destination for a visitor. Precedence: a matching per-country rule
 * wins first, then the per-OS deep links (iOS / Android / desktop), then the
 * canonical `destination`. Run on the cached payload so it stays on the edge hot
 * path with no extra DB read. `country` is the edge-detected ISO-3166 alpha-2
 * code (uppercased here); unknown/missing simply skips the geo step.
 */
export function routeDestination(
  link: CachedLink,
  country: string | null,
  os: string | null,
  deviceType: string | null,
): string {
  if (country && link.geoRules && link.geoRules.length > 0) {
    const cc = country.toUpperCase();
    const rule = link.geoRules.find((r) => r.country === cc);
    if (rule) return rule.url;
  }
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
