import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import postgres from "postgres";
import * as pgSchema from "./schema";
import * as sqliteSchema from "./schema.sqlite";
import type { AppBindings } from "../env";

export type Dialect = "postgres" | "sqlite";

/** The query layer is typed against the Postgres schema; the SQLite schema has
 *  the same shape, so it is cast to this type at the D1 boundary. */
export type DbSchema = typeof pgSchema;
export type DB = ReturnType<typeof pgClient>;

export interface DbHandle {
  db: DB;
  schema: DbSchema;
  dialect: Dialect;
  /** Release the connection (Postgres pool client); a no-op for D1. */
  close: () => Promise<void>;
}

function pgClient(env: AppBindings) {
  const client = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
    prepare: false,
  });
  return drizzlePg(client, { schema: pgSchema, casing: "snake_case" });
}

/** Which driver to use is fixed at deploy time via the `DB_DRIVER` var
 *  ("postgres" | "d1"), defaulting to Postgres for backwards compatibility. */
export function resolveDialect(env: AppBindings): Dialect {
  return (env.DB_DRIVER as string | undefined) === "d1" ? "sqlite" : "postgres";
}

/**
 * Build a request-scoped DB handle for the configured driver. Both drivers use
 * the same Drizzle query API, so callers are dialect-agnostic except for a few
 * raw-SQL spots (see worker/routes/stats.ts) that branch on `dialect`.
 */
export function getDbHandle(env: AppBindings): DbHandle {
  if (resolveDialect(env) === "sqlite") {
    if (!env.DB) {
      throw new Error("DB_DRIVER=d1 but no D1 binding `DB` is configured");
    }
    const db = drizzleD1(env.DB, {
      schema: sqliteSchema,
      casing: "snake_case",
    }) as unknown as DB;
    return {
      db,
      schema: sqliteSchema as unknown as DbSchema,
      dialect: "sqlite",
      close: async () => {},
    };
  }

  const db = pgClient(env);
  return {
    db,
    schema: pgSchema,
    dialect: "postgres",
    close: () => db.$client.end({ timeout: 5 }),
  };
}
