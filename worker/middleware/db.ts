import { createMiddleware } from "hono/factory";
import { getDb } from "../db";
import type { AppEnv } from "../env";

/**
 * One DB client per request. Hyperdrive pools the real connections, so this is
 * cheap. We close the client after the response via waitUntil so it never adds
 * latency to the response itself.
 */
export const dbMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const db = getDb(c.env);
  c.set("db", db);
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(db.$client.end({ timeout: 5 }));
  }
});
