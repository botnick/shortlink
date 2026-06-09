import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, count, eq, ne } from "drizzle-orm";
import type { AppEnv } from "../env";
import { hashPassword, verifyPassword } from "../lib/password";
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
  return Boolean(hash) && verifyPassword(currentPassword, hash!);
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
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, c.var.user!.id));
  await c.var.db
    .delete(sessions)
    .where(
      and(eq(sessions.userId, c.var.user!.id), ne(sessions.id, c.var.sessionId!)),
    );
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
