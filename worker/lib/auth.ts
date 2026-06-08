import { eq } from "drizzle-orm";
import { sessions, users } from "../db/schema";
import type { DB } from "../db";
import type { SessionUser } from "../env";
import { randomHex } from "./encoding";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days absolute
const SESSION_RENEW_MS = 1000 * 60 * 60 * 24 * 15; // sliding renew when < 15 days left

export function generateSessionId(): string {
  return randomHex(32);
}

export async function createSession(
  db: DB,
  userId: string,
): Promise<{ id: string; expiresAt: Date }> {
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

export interface ValidatedSession {
  user: SessionUser;
  expiresAt: Date;
  renewed: boolean;
}

export async function validateSession(
  db: DB,
  id: string,
): Promise<ValidatedSession | null> {
  const rows = await db
    .select({
      sessionExpiresAt: sessions.expiresAt,
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
  if (expiresAt.getTime() - now < SESSION_RENEW_MS) {
    expiresAt = new Date(now + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    renewed = true;
  }

  return {
    user: { id: row.userId, email: row.email, role: row.role },
    expiresAt,
    renewed,
  };
}

export async function invalidateSession(db: DB, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}
