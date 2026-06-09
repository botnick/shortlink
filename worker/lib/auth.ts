import { eq } from "drizzle-orm";
import type { DB, DbSchema } from "../db";
import type { SessionUser } from "../env";
import { randomHex } from "./encoding";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days absolute
const SESSION_RENEW_MS = 1000 * 60 * 60 * 24 * 15; // sliding renew when < 15 days left
const ACTIVITY_TOUCH_MS = 1000 * 60 * 5; // stamp last_active at most every 5 min

export function generateSessionId(): string {
  return randomHex(32);
}

/** Device snapshot recorded at sign-in, shown on the account's session list. */
export interface SessionMeta {
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  country?: string | null;
}

export async function createSession(
  db: DB,
  schema: DbSchema,
  userId: string,
  meta: SessionMeta = {},
): Promise<{ id: string; expiresAt: Date }> {
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({
    id,
    userId,
    expiresAt,
    browser: meta.browser ?? null,
    os: meta.os ?? null,
    deviceType: meta.deviceType ?? null,
    country: meta.country ?? null,
    lastActiveAt: new Date(),
  });
  return { id, expiresAt };
}

export interface ValidatedSession {
  user: SessionUser;
  expiresAt: Date;
  renewed: boolean;
}

export async function validateSession(
  db: DB,
  schema: DbSchema,
  id: string,
): Promise<ValidatedSession | null> {
  const { sessions, users } = schema;
  const rows = await db
    .select({
      sessionExpiresAt: sessions.expiresAt,
      lastActiveAt: sessions.lastActiveAt,
      createdAt: sessions.createdAt,
      userId: users.id,
      email: users.email,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  if (row.sessionExpiresAt.getTime() <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  let expiresAt = row.sessionExpiresAt;
  let renewed = false;
  // Keep the session-list's "last active" honest without a write per request:
  // stamp at most every ACTIVITY_TOUCH_MS, folded into the renew update if both.
  const lastSeen = (row.lastActiveAt ?? row.createdAt).getTime();
  const touch = now - lastSeen > ACTIVITY_TOUCH_MS;
  if (expiresAt.getTime() - now < SESSION_RENEW_MS) {
    expiresAt = new Date(now + SESSION_TTL_MS);
    await db
      .update(sessions)
      .set({ expiresAt, lastActiveAt: new Date(now) })
      .where(eq(sessions.id, id));
    renewed = true;
  } else if (touch) {
    await db
      .update(sessions)
      .set({ lastActiveAt: new Date(now) })
      .where(eq(sessions.id, id));
  }

  return {
    user: { id: row.userId, email: row.email, role: row.role },
    expiresAt,
    renewed,
  };
}

export async function invalidateSession(
  db: DB,
  schema: DbSchema,
  id: string,
): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
}
