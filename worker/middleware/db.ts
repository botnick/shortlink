import { createMiddleware } from "hono/factory";
import { getDbHandle } from "../db";
import type { AppEnv } from "../env";

/**
 * One DB handle per request. For Postgres, Hyperdrive pools the real
 * connections so this is cheap and the client is closed after the response via
 * waitUntil; for D1 the close is a no-op. The active schema + dialect are put on
 * the context so handlers stay driver-agnostic.
 */
export const dbMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const { db, schema, dialect, close } = getDbHandle(c.env);
  c.set("db", db);
  c.set("schema", schema);
  c.set("dialect", dialect);
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(close());
  }
});
