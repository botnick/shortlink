import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Local dev keeps everything in ONE file (.dev.vars). CI/prod can instead set
// DATABASE_URL directly in the environment — it takes precedence (dotenv does
// not override already-set variables).
loadEnv({ path: ".dev.vars" });
loadEnv({ path: ".env" });

const url =
  process.env.DATABASE_URL ??
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;

if (!url) {
  throw new Error(
    "Set DATABASE_URL, or CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE in .dev.vars",
  );
}

export default defineConfig({
  schema: "./worker/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
