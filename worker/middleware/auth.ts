import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { validateSession } from "../lib/auth";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "../lib/cookies";

/** Loads the session (if any) into context. Never blocks the request. */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", null);
  c.set("sessionId", null);

  const token = await readSessionCookie(c);
  if (token) {
    const result = await validateSession(c.var.db, c.var.schema, token);
    if (result) {
      c.set("user", result.user);
      c.set("sessionId", token);
      if (result.renewed) {
        await setSessionCookie(c, token, result.expiresAt);
      }
    } else {
      clearSessionCookie(c);
    }
  }

  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) return c.json({ error: "Unauthorized" }, 401);
  if (c.var.user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  await next();
});
