// Runs after `wrangler deploy` (see the `deploy` script). When DB_DRIVER="d1",
// it applies the D1 migrations in drizzle/sqlite to the remote database — which
// Cloudflare auto-creates on the first deploy — so a one-click / CI deploy comes
// up with a ready schema and no manual step.
//
// For Postgres (DB_DRIVER="postgres") it is a no-op: a DB firewall locked to
// Cloudflare IP ranges often blocks CI runners, so run `npm run db:migrate`
// yourself from an allowed machine (see docs/DEPLOYMENT.md).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

let driver = "d1";
let dbName = "shortlink-db";
try {
  // The built config is plain JSON (no comments) — read the active driver + name.
  const cfg = JSON.parse(readFileSync("dist/shortlink/wrangler.json", "utf8"));
  driver = cfg.vars?.DB_DRIVER ?? driver;
  dbName = cfg.d1_databases?.[0]?.database_name ?? dbName;
} catch {
  // No built config available — fall back to the defaults above.
}

if (driver !== "d1") {
  console.log(`[postdeploy] DB_DRIVER=${driver}: skipping D1 migrations.`);
  process.exit(0);
}

console.log(`[postdeploy] Applying D1 migrations to "${dbName}" (--remote)…`);
execSync(`npx wrangler d1 migrations apply ${dbName} --remote`, {
  stdio: "inherit",
});
