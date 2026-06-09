/**
 * Account lifecycle: closing an account is a SOFT delete. The account is held
 * (unusable but recoverable by an operator) for `accountHoldDays`, then purged
 * by cron; the email stays unregistrable for `emailBlockDays` beyond that via
 * a tombstone row that survives the purge. Nothing user-facing ever explains
 * why an email can't register — the message stays generic by design.
 */
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { AppBindings } from "../env";
import { getDbHandle, type DB, type DbSchema } from "../db";
import { purgeLinkCache } from "./linkCache";
import { invalidateApiKey } from "./apikeys";
import {
  accountHoldDaysFrom,
  emailBlockDaysFrom,
  getAllSettings,
} from "./settings";

const DAY_MS = 86_400_000;

/**
 * Close an account immediately: links stop redirecting, every session and API
 * key dies, and the email is tombstoned. The user row stays (deleted_at set)
 * until the cron purges it after the hold window.
 */
export async function softDeleteUser(
  env: AppBindings,
  db: DB,
  schema: DbSchema,
  userId: string,
): Promise<void> {
  const { users, links, sessions, apiKeys, deletedAccounts } = schema;
  const now = new Date();

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return;

  // Pause every link and purge each entry point's edge cache so redirects stop
  // on the next click, not when the cache expires.
  const owned = await db
    .select({ id: links.id, slug: links.slug, domainId: links.domainId })
    .from(links)
    .where(eq(links.userId, userId));
  if (owned.length > 0) {
    await db.update(links).set({ isActive: false }).where(eq(links.userId, userId));
    await Promise.all(owned.map((l) => purgeLinkCache(env, db, schema, l)));
  }

  // Kill credentials: all sessions, all API keys (and their KV lookups).
  await db.delete(sessions).where(eq(sessions.userId, userId));
  const keys = await db
    .select({ keyHash: apiKeys.keyHash })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId));
  if (keys.length > 0) {
    await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
    await Promise.all(keys.map((k) => invalidateApiKey(env, k.keyHash)));
  }

  // Tombstone the email (upsert — re-deleting refreshes the window) and mark
  // the user row as deleted.
  await db
    .insert(deletedAccounts)
    .values({ email: user.email.toLowerCase(), deletedAt: now })
    .onConflictDoUpdate({
      target: deletedAccounts.email,
      set: { deletedAt: now },
    });
  await db.update(users).set({ deletedAt: now }).where(eq(users.id, userId));
}

/** Is this email inside its no-register window? (Generic refusal upstream.) */
export function isEmailBlocked(
  tombstoneDeletedAt: Date,
  settings: Record<string, unknown>,
): boolean {
  const windowMs =
    (accountHoldDaysFrom(settings) + emailBlockDaysFrom(settings)) * DAY_MS;
  return Date.now() < tombstoneDeletedAt.getTime() + windowMs;
}

/**
 * Cron: hard-delete accounts whose hold window has passed (cascades links,
 * aliases, clicks, domains), clean up their R2 OG images, and prune tombstones
 * whose full no-register window is over.
 */
export async function purgeDeletedAccounts(env: AppBindings): Promise<void> {
  const { db, schema, close } = getDbHandle(env);
  try {
    const settings = await getAllSettings(db, schema);
    const holdMs = accountHoldDaysFrom(settings) * DAY_MS;
    const blockMs = emailBlockDaysFrom(settings) * DAY_MS;
    const { users, links, deletedAccounts } = schema;

    const doomed = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNotNull(users.deletedAt), lt(users.deletedAt, new Date(Date.now() - holdMs))));

    if (doomed.length > 0) {
      const ids = doomed.map((u) => u.id);
      // Free the R2 blobs the cascade can't reach.
      const ogRows = await db
        .select({ id: links.id })
        .from(links)
        .where(and(inArray(links.userId, ids), eq(links.ogImage, "r2")));
      await Promise.all(
        ogRows.map((l) => env.LOGO_BUCKET.delete(`og/${l.id}`).catch(() => {})),
      );
      await db.delete(users).where(inArray(users.id, ids));
    }

    // Tombstones past hold+block are done — the email may register again.
    await db
      .delete(deletedAccounts)
      .where(lt(deletedAccounts.deletedAt, new Date(Date.now() - holdMs - blockMs)));
  } finally {
    await close();
  }
}
