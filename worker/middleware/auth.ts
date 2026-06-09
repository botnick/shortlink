import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { validateSession } from "../lib/auth";
import { resolveApiKey, touchApiKey } from "../lib/apikeys";
import { isRateLimited } from "../lib/ratelimit";
import { apiEnabledFrom, apiRateLimitFrom, getAllSettings } from "../lib/settings";
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

/**
 * Bearer API-key auth for the public API. Runs after `loadSession`: a session
 * (cookie) wins; otherwise `Authorization: Bearer sk_…` resolves to the key's
 * owner. Bearer requests are CSRF-immune by construction (browsers can't set
 * the header cross-site), so they pass the origin checks untouched.
 */
export const apiKeyAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) {
    const auth = c.req.header("authorization");
    if (auth?.startsWith("Bearer ")) {
      const settings = await getAllSettings(c.var.db, c.var.schema);
      if (!apiEnabledFrom(settings)) {
        return c.json({ error: "The API is currently disabled" }, 403);
      }
      const resolved = await resolveApiKey(
        c.env,
        c.var.db,
        c.var.schema,
        auth.slice(7).trim(),
      );
      if (!resolved) {
        return c.json({ error: "Invalid or revoked API key" }, 401);
      }
      if (
        await isRateLimited(
          c.env,
          `api:${resolved.keyId}`,
          apiRateLimitFrom(settings),
          60,
        )
      ) {
        return c.json({ error: "Rate limit exceeded — slow down" }, 429);
      }
      c.set("user", resolved.user);
      c.executionCtx.waitUntil(
        touchApiKey(c.env, resolved.keyId).catch(() => {}),
      );
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
