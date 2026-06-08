import { defineConfig } from "drizzle-kit";

// SQLite / Cloudflare D1 migrations. Generated SQL lands in drizzle/sqlite and
// is applied to D1 with `wrangler d1 migrations apply` (see README).
export default defineConfig({
  schema: "./worker/db/schema.sqlite.ts",
  out: "./drizzle/sqlite",
  dialect: "sqlite",
  casing: "snake_case",
  strict: true,
  verbose: true,
});
