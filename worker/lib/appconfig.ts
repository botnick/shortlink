import { getDbHandle } from "../db";
import type { AppBindings } from "../env";
import { getPublicConfig } from "./settings";
import type { AppConfigDTO } from "@shared/types";

const KEY = "config:v2"; // v2: + appOrigin, shortDomain falls back to the app host

/**
 * Public app config, cached in KV. The SPA fetches this on every page load, so
 * serving it from the edge (no DB round-trip on a hit) is the single biggest
 * way to keep the Worker cheap under traffic. Invalidated on setup/settings
 * changes; a 1h TTL is just a backstop.
 */
export async function getCachedPublicConfig(env: AppBindings): Promise<AppConfigDTO> {
  const cached = await env.LINKS_KV.get<AppConfigDTO>(KEY, "json");
  if (cached) return cached;

  const { db, schema, close } = getDbHandle(env);
  try {
    const cfg = await getPublicConfig(db, schema, env.APP_URL);
    await env.LINKS_KV.put(KEY, JSON.stringify(cfg), { expirationTtl: 3600 });
    return cfg;
  } finally {
    await close();
  }
}

export async function invalidatePublicConfig(kv: KVNamespace): Promise<void> {
  await kv.delete(KEY);
}
