/**
 * Edge cache for the redirect hot path. Postgres stays the source of truth;
 * KV is a globally-replicated read cache so redirects rarely touch the DB.
 */
export interface CachedLink {
  id: string;
  destination: string;
  isActive: boolean;
  /** epoch ms, or null when the link never expires */
  expiresAt: number | null;
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
