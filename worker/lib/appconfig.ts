import { getDbHandle } from "../db";
import type { AppBindings } from "../env";
import { getPublicConfig } from "./settings";
import type { AppConfigDTO } from "@shared/types";

const KEY = "config:v3"; // v3: + appOrigin (honors the admin Short domain) + mcpEnabled

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
  if (memo && memo.until > Date.now()) return memo.cfg;
  const cached = await env.LINKS_KV.get<AppConfigDTO>(KEY, "json");
  if (cached) {
    memo = { cfg: cached, until: Date.now() + MEMO_MS };
    return cached;
  }

  const { db, schema, close } = getDbHandle(env);
  try {
    const cfg = await getPublicConfig(db, schema, env.APP_URL);
    await env.LINKS_KV.put(KEY, JSON.stringify(cfg), { expirationTtl: 3600 });
    memo = { cfg, until: Date.now() + MEMO_MS };
    return cfg;
  } finally {
    await close();
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
