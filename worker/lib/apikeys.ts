/**
 * API keys for the public API. A key looks like `sk_<48 hex chars>` and is
 * shown exactly once at creation; only its SHA-256 is stored. Lookups on the
 * request path are cached briefly in KV so a busy integration doesn't hit the
 * database on every call.
 */
import { eq } from "drizzle-orm";
import type { AppBindings, SessionUser } from "../env";
import { getDbHandle, type DB, type DbSchema } from "../db";
import { bytesToHex, randomHex } from "./encoding";
import { counterBump, counterGet } from "./ratelimit";

const KEY_RE = /^sk_[0-9a-f]{48}$/;
const CACHE_TTL = 300; // seconds; revocation deletes the entry explicitly

export function generateApiKey(): { key: string; prefix: string } {
  const key = `sk_${randomHex(24)}`;
  return { key, prefix: key.slice(0, 11) }; // "sk_" + 8 chars
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return bytesToHex(new Uint8Array(digest));
}

interface CachedKey {
  keyId: string;
  user: SessionUser;
}

/**
 * Resolve a bearer key to its owner. Returns null for unknown/revoked keys.
 * The (hash → user) mapping is KV-cached; revoking a key clears the entry.
 */
export async function resolveApiKey(
  env: AppBindings,
  db: DB,
  schema: DbSchema,
  key: string,
): Promise<CachedKey | null> {
  if (!KEY_RE.test(key)) return null;
  const hash = await hashApiKey(key);
  const cacheKey = `apikey:${hash}`;

  try {
    const hit = await env.LINKS_KV.get<CachedKey>(cacheKey, "json");
    if (hit) return hit;
  } catch {
    // KV unavailable / over read quota → resolve from the DB instead of 500ing.
  }

  const { apiKeys, users } = schema;
  const rows = await db
    .select({
      keyId: apiKeys.id,
      id: users.id,
      email: users.email,
      role: users.role,
    })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const value: CachedKey = {
    keyId: row.keyId,
    user: { id: row.id, email: row.email, role: row.role },
  };
  // Fire-and-forget cache fill — the key is already resolved, so a KV write
  // blip / quota must not fail the request.
  await env.LINKS_KV.put(cacheKey, JSON.stringify(value), {
    expirationTtl: CACHE_TTL,
  }).catch(() => {});
  return value;
}

/** Drop the cached lookup for a key hash (call when the key is revoked). */
export async function invalidateApiKey(
  env: AppBindings,
  keyHash: string,
): Promise<void> {
  await env.LINKS_KV.delete(`apikey:${keyHash}`);
}

/** Stamp last_used_at, throttled to once a minute per key. The throttle guard
 *  lives in the DO counter (not KV) so a busy integration's per-call guard write
 *  stays off the KV budget. Opens its own DB handle — it runs in waitUntil,
 *  after the request's handle may be closed. */
export async function touchApiKey(
  env: AppBindings,
  keyId: string,
): Promise<void> {
  const guard = `apikeyts:${keyId}`;
  if ((await counterGet(env, guard)) > 0) return;
  await counterBump(env, guard, 60);
  const { db, schema, close } = getDbHandle(env);
  try {
    const { apiKeys } = schema;
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, keyId));
  } finally {
    await close();
  }
}
