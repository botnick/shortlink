import { getDbHandle } from "../db";
import type { AppBindings } from "../env";
import { getPublicConfig } from "./settings";
import type { AppConfigDTO } from "@shared/types";

const KEY = "config:v9"; // v9: shortDomain now derives from APP_URL (setting removed)

// In-isolate memo so hot paths (e.g. building 20 short URLs in one list
// response) don't pay a KV read each time. Tiny TTL keeps edits near-instant.
let memo: { cfg: AppConfigDTO; until: number } | null = null;
const MEMO_MS = 30_000;

/**
 * Public app config, cached in KV. The SPA fetches this on every page load, so
 * serving it from the edge (no DB round-trip on a hit) is the single biggest
 * way to keep the Worker cheap under traffic. Invalidated on setup/settings
 * changes; a 1h TTL is just a backstop.
 */
export async function getCachedPublicConfig(env: AppBindings): Promise<AppConfigDTO> {
  const now = Date.now();
  if (memo && memo.until > now) return memo.cfg;

  try {
    const cached = await env.LINKS_KV.get<AppConfigDTO>(KEY, "json");
    if (cached) {
      memo = { cfg: cached, until: now + MEMO_MS };
      return cached;
    }
  } catch {
    // KV unavailable / over read quota → fall back to the DB (and stale memo).
  }

  try {
    const { db, schema, close } = getDbHandle(env);
    try {
      const cfg = await getPublicConfig(db, schema, env.APP_URL);
      await env.LINKS_KV.put(KEY, JSON.stringify(cfg), { expirationTtl: 3600 }).catch(() => {});
      memo = { cfg, until: now + MEMO_MS };
      return cfg;
    } finally {
      await close();
    }
  } catch (err) {
    // DB also down: serve the last config we successfully loaded rather than
    // 500ing the whole SPA. Only propagate if we've never loaded one.
    if (memo) return memo.cfg;
    throw err;
  }
}

/** Canonical origin for displaying short links (the admin Short domain). */
export async function shortOrigin(env: AppBindings): Promise<string> {
  return (await getCachedPublicConfig(env)).appOrigin;
}

export async function invalidatePublicConfig(kv: KVNamespace): Promise<void> {
  memo = null;
  await kv.delete(KEY);
}
