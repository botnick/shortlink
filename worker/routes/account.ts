import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, count, eq, ne } from "drizzle-orm";
import type { AppEnv } from "../env";
import { hashPassword, pbkdf2Iterations, verifyPassword } from "../lib/password";
import { clearSessionCookie } from "../lib/cookies";
import { isRateLimited } from "../lib/ratelimit";
import { authRateLimitFrom, getAllSettings } from "../lib/settings";
import { getClientIp } from "../lib/geo";
import { changePasswordSchema, deleteAccountSchema } from "../lib/validators";
import { softDeleteUser } from "../lib/accountLifecycle";
import { requireAuth } from "../middleware/auth";

/**
 * Self-service account management. Session-only on purpose (like API keys): a
 * leaked bearer key must never be able to rotate the password, change the
 * email or delete the account. Every mutation re-proves the current password.
 */
const route = new Hono<AppEnv>();
route.use("*", requireAuth);
route.use("*", async (c, next) => {
  if (!c.var.sessionId) {
    return c.json({ error: "Manage your account from the dashboard" }, 403);
  }
  await next();
});

/** Per-IP throttle on password attempts (same knob as login: authRateLimit). */
async function throttled(c: Parameters<typeof getClientIp>[0]): Promise<boolean> {
  const settings = await getAllSettings(c.var.db, c.var.schema);
  return isRateLimited(
    c.env,
    `account:${getClientIp(c)}`,
    authRateLimitFrom(settings),
    15 * 60,
  );
}

/** Verify the caller's current password (uniform error). */
async function checkPassword(
  c: Parameters<typeof getClientIp>[0],
  currentPassword: string,
): Promise<boolean> {
  const { users } = c.var.schema;
  const rows = await c.var.db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, c.var.user!.id))
    .limit(1);
  const hash = rows[0]?.passwordHash;
  return Boolean(hash) && verifyPassword(currentPassword, hash!, c.env.SESSION_SECRET);
}

// Summary for the account page: email, role, member-since, session count.
route.get("/", async (c) => {
  const { users, sessions } = c.var.schema;
  const [row] = await c.var.db
    .select({ email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, c.var.user!.id))
    .limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  const [{ n }] = await c.var.db
    .select({ n: count() })
    .from(sessions)
    .where(eq(sessions.userId, c.var.user!.id));
  return c.json({
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    activeSessions: Number(n),
  });
});

// Change password → other sessions are signed out; this one stays.
route.patch("/password", zValidator("json", changePasswordSchema), async (c) => {
  if (await throttled(c)) {
    return c.json({ error: "Too many attempts — please try again later" }, 429);
  }
  const { currentPassword, newPassword } = c.req.valid("json");
  if (!(await checkPassword(c, currentPassword))) {
    return c.json({ error: "Current password is incorrect" }, 403);
  }
  const { users, sessions } = c.var.schema;
  await c.var.db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword, c.env.SESSION_SECRET, pbkdf2Iterations(c.env)) })
    .where(eq(users.id, c.var.user!.id));
  await c.var.db
    .delete(sessions)
    .where(
      and(eq(sessions.userId, c.var.user!.id), ne(sessions.id, c.var.sessionId!)),
    );
  return c.json({ ok: true });
});

// Active sessions — current first, then most recently active. `publicId` is the
// only identifier exposed; the session token itself never leaves the server.
route.get("/sessions", async (c) => {
  const { sessions } = c.var.schema;
  const rows = await c.var.db
    .select({
      publicId: sessions.publicId,
      tokenId: sessions.id,
      browser: sessions.browser,
      os: sessions.os,
      deviceType: sessions.deviceType,
      country: sessions.country,
      lastActiveAt: sessions.lastActiveAt,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, c.var.user!.id));
  const items = rows
    .map((r) => ({
      id: r.publicId,
      current: r.tokenId === c.var.sessionId,
      browser: r.browser,
      os: r.os,
      deviceType: r.deviceType,
      country: r.country,
      lastActiveAt: (r.lastActiveAt ?? r.createdAt).toISOString(),
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt),
    );
  return c.json({ sessions: items });
});

// Revoke one session by its public id. The current one is excluded — that's
// what Sign out is for.
route.delete("/sessions/:publicId", async (c) => {
  const publicId = c.req.param("publicId");
  if (!/^[0-9a-f-]{8,64}$/i.test(publicId)) return c.json({ error: "Not found" }, 404);
  const { sessions } = c.var.schema;
  const removed = await c.var.db
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, c.var.user!.id),
        eq(sessions.publicId, publicId),
        ne(sessions.id, c.var.sessionId!),
      ),
    )
    .returning({ id: sessions.id });
  if (!removed[0]) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// Sign out everywhere else (keeps this session).
route.post("/sessions/revoke-others", async (c) => {
  const { sessions } = c.var.schema;
  const removed = await c.var.db
    .delete(sessions)
    .where(
      and(eq(sessions.userId, c.var.user!.id), ne(sessions.id, c.var.sessionId!)),
    )
    .returning({ id: sessions.id });
  return c.json({ ok: true, revoked: removed.length });
});

// Close the account: links stop working and sign-in is disabled immediately.
// (Soft delete — held for the configured window, then purged by cron.)
route.delete("/", zValidator("json", deleteAccountSchema), async (c) => {
  if (await throttled(c)) {
    return c.json({ error: "Too many attempts — please try again later" }, 429);
  }
  const { currentPassword } = c.req.valid("json");
  if (!(await checkPassword(c, currentPassword))) {
    return c.json({ error: "Current password is incorrect" }, 403);
  }
  const { users } = c.var.schema;
  // The primary admin anchors the install — it can't delete itself.
  const [row] = await c.var.db
    .select({ isPrimary: users.isPrimary })
    .from(users)
    .where(eq(users.id, c.var.user!.id))
    .limit(1);
  if (row?.isPrimary) {
    return c.json(
      { error: "The primary admin account can’t be deleted" },
      400,
    );
  }
  await softDeleteUser(c.env, c.var.db, c.var.schema, c.var.user!.id);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

export default route;
