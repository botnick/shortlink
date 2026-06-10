/**
 * Per-domain back-half routing. A short link's slug is unique *within a domain*,
 * so the redirect (and every public slug lookup) must first resolve which domain
 * the incoming request host maps to, then look the slug up in that bucket.
 */
import { and, eq, isNull, type AnyColumn, type SQL } from "drizzle-orm";
import type { AppContext, AppBindings } from "../env";
import type { DB, DbSchema } from "../db";
import type { LinkRow } from "../db/schema";
import { getDbHandle } from "../db";

export interface DomainScope {
  /** Matched custom-domain id, or null for the default short-host bucket. */
  domainId: string | null;
  /** Hostname to build this link's short URL on. */
  host: string;
}

/** The canonical default short host, derived from APP_URL. */
export function appHost(env: AppBindings): string {
  try {
    return new URL(env.APP_URL).host;
  } catch {
    return "";
  }
}

/** Build a short URL on the right host: the link's custom domain, else the
 *  canonical default origin (admin Short domain — see `shortOrigin(env)`). */
export function buildShortUrl(
  defaultOrigin: string,
  domainHost: string | null,
  slug: string,
): string {
  const base = domainHost ? `https://${domainHost}` : defaultOrigin.replace(/\/+$/, "");
  return `${base}/${slug}`;
}

const DOMAIN_TTL = 300; // 5 min — domains change rarely; staleness is harmless

// In-isolate memo of host→domainId so a warm isolate serving repeated hits to
// the same custom host pays ZERO KV reads for scope resolution (a custom-domain
// redirect drops from 2 KV reads to 1). Tiny TTL keeps domain changes near-live;
// bounded so it can't grow without limit.
const hostMemo = new Map<string, { id: string | null; until: number }>();
const HOST_MEMO_MS = 30_000;

/**
 * Map an incoming request host to a domain scope. Unknown hosts fall back to the
 * default bucket so the apex / *.workers.dev URL still resolves default links.
 */
export async function resolveScope(
  c: AppContext,
  reqHost: string | null | undefined,
): Promise<DomainScope> {
  const fallback = appHost(c.env);
  const host = (reqHost || fallback).toLowerCase();
  if (!host || host === fallback.toLowerCase()) {
    return { domainId: null, host: fallback };
  }
  const domainId = await resolveDomainId(c, host);
  return domainId ? { domainId, host } : { domainId: null, host: fallback };
}

/** Resolve a custom-domain id from a hostname (in-isolate memo → KV → DB). Every
 *  layer degrades to the next on failure, and a total failure falls back to the
 *  default bucket (null) so the redirect still resolves a default-host link
 *  rather than 500ing when KV or the DB is unavailable. */
async function resolveDomainId(c: AppContext, host: string): Promise<string | null> {
  const now = Date.now();
  const memo = hostMemo.get(host);
  if (memo && memo.until > now) return memo.id;

  const kv = c.env.LINKS_KV;
  const cacheKey = `dhost:${host}`;
  try {
    const hit = await kv.get(cacheKey);
    if (hit !== null) {
      const id = hit === "" ? null : hit;
      remember(host, id, now);
      return id;
    }
  } catch {
    // KV unavailable / over read quota → resolve from the DB instead.
  }

  try {
    const { db, schema, close } = getDbHandle(c.env);
    try {
      const { domains } = schema;
      const rows = await db
        .select({ id: domains.id })
        .from(domains)
        .where(eq(domains.hostname, host))
        .limit(1);
      const id = rows[0]?.id ?? null;
      c.executionCtx.waitUntil(
        kv.put(cacheKey, id ?? "", { expirationTtl: DOMAIN_TTL }).catch(() => {}),
      );
      remember(host, id, now);
      return id;
    } finally {
      c.executionCtx.waitUntil(close());
    }
  } catch {
    // DB also unavailable — fall back to the default bucket so default-host
    // links keep resolving. (A custom-domain link can't resolve in this state,
    // but the visitor gets a branded 404, never a 500.)
    return null;
  }
}

function remember(host: string, id: string | null, now: number): void {
  if (hostMemo.size > 500) hostMemo.clear(); // bound the per-isolate memo
  hostMemo.set(host, { id, until: now + HOST_MEMO_MS });
}

/** Drop the host→domain cache entry (call when a domain is added/removed). */
export async function invalidateDomainHost(
  kv: KVNamespace,
  hostname: string,
): Promise<void> {
  await kv.delete(`dhost:${hostname.toLowerCase()}`);
}

/** WHERE filter selecting one domain bucket (null = the default host). */
export function domainBucket(col: AnyColumn, domainId: string | null): SQL {
  return (domainId ? eq(col, domainId) : isNull(col)) as SQL;
}

/**
 * Find a link by (domain, slug) — first as a live back-half, then as a retired
 * alias pointing at its link. Returns the full link row, or null.
 */
export async function findLinkRow(
  db: DB,
  schema: DbSchema,
  domainId: string | null,
  slug: string,
): Promise<LinkRow | null> {
  const { links, linkAliases } = schema;
  const direct = await db
    .select()
    .from(links)
    .where(and(eq(links.slug, slug), domainBucket(links.domainId, domainId)))
    .limit(1);
  if (direct[0]) return direct[0] as LinkRow;

  const viaAlias = await db
    .select()
    .from(links)
    .innerJoin(linkAliases, eq(linkAliases.linkId, links.id))
    .where(
      and(eq(linkAliases.slug, slug), domainBucket(linkAliases.domainId, domainId)),
    )
    .limit(1);
  return (viaAlias[0]?.links as LinkRow | undefined) ?? null;
}
