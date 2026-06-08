import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { AppBindings } from "../env";

/**
 * Create a DB client backed by Hyperdrive. Hyperdrive pools the underlying
 * connections, so creating a fresh client per request is cheap. `prepare: false`
 * keeps us safe behind the pooler; `fetch_types: false` avoids an extra round-trip.
 */
export function getDb(env: AppBindings) {
  const client = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
    prepare: false,
  });
  return drizzle(client, { schema, casing: "snake_case" });
}

export type DB = ReturnType<typeof getDb>;
