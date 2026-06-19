/**
 * Edge-cache helpers that understand a link's multiple entry points: its live
 * back-half plus any retired aliases (Bitly-style old links that still work).
 * Every entry point is cached under its own (domain, slug) key.
 */
import { eq } from "drizzle-orm";
import type { AppBindings } from "../env";
import type { DB, DbSchema } from "../db";
import type { LinkRow } from "../db/schema";
import { deleteCachedLink, putCachedLink, type CachedLink } from "./cache";

/** Project a link row down to the small payload the redirect hot path needs. */
export function cachePayload(row: LinkRow): CachedLink {
  return {
    id: row.id,
    destination: row.destination,
    iosUrl: row.iosUrl,
    androidUrl: row.androidUrl,
    desktopUrl: row.desktopUrl,
    geoRules: row.geoRules ?? null,
    isActive: row.isActive,
    hasPassword: Boolean(row.passwordHash),
    expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
  };
}

async function aliasKeys(
  db: DB,
  schema: DbSchema,
  linkId: string,
): Promise<{ domainId: string | null; slug: string }[]> {
  const { linkAliases } = schema;
  return db
    .select({ domainId: linkAliases.domainId, slug: linkAliases.slug })
    .from(linkAliases)
    .where(eq(linkAliases.linkId, linkId));
}

/** Warm every entry point of a link (live back-half + retained aliases). */
export async function refreshLinkCache(
  env: AppBindings,
  db: DB,
  schema: DbSchema,
  row: LinkRow,
): Promise<void> {
  const aliases = await aliasKeys(db, schema, row.id);
  const payload = cachePayload(row);
  await Promise.all([
    putCachedLink(env.LINKS_KV, row.domainId, row.slug, payload),
    ...aliases.map((a) => putCachedLink(env.LINKS_KV, a.domainId, a.slug, payload)),
  ]);
}

/** Drop the cache for every entry point of a link (call before deleting it). */
export async function purgeLinkCache(
  env: AppBindings,
  db: DB,
  schema: DbSchema,
  ref: { id: string; domainId: string | null; slug: string },
): Promise<void> {
  const aliases = await aliasKeys(db, schema, ref.id);
  await Promise.all([
    deleteCachedLink(env.LINKS_KV, ref.domainId, ref.slug),
    ...aliases.map((a) => deleteCachedLink(env.LINKS_KV, a.domainId, a.slug)),
  ]);
}
