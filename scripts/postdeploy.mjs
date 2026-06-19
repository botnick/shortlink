// Runs after `wrangler deploy` (see the `deploy` script). When DB_DRIVER="d1",
// it applies the D1 migrations to the remote database — which Cloudflare
// auto-creates on the first deploy — so a one-click / CI deploy comes up with a
// ready schema and no manual step. The actual migrate (incl. resolving the
// auto-provisioned database_id) lives in scripts/d1-migrate.mjs, shared with
// `npm run db:migrate:d1`.
//
// For Postgres (DB_DRIVER="postgres") it is a no-op: a DB firewall locked to
// Cloudflare IP ranges often blocks CI runners, so run `npm run db:migrate`
// yourself from an allowed machine (see docs/DEPLOYMENT.md).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let driver = "d1";
try {
  // The built config is plain JSON (no comments) — read the active driver.
  const cfg = JSON.parse(readFileSync("dist/shortlink/wrangler.json", "utf8"));
  driver = cfg.vars?.DB_DRIVER ?? driver;
} catch {
  // No built config available — assume the D1 default.
}

if (driver !== "d1") {
  console.log(`[postdeploy] DB_DRIVER=${driver}: skipping D1 migrations.`);
  process.exit(0);
}

execFileSync("node", ["scripts/d1-migrate.mjs"], { stdio: "inherit" });
