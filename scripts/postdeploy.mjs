// Runs after `wrangler deploy` (see the `deploy` script). When DB_DRIVER="d1",
// it applies the D1 migrations in drizzle/sqlite to the remote database — which
// Cloudflare auto-creates on the first deploy — so a one-click / CI deploy comes
// up with a ready schema and no manual step.
//
// `wrangler d1 migrations apply --remote` needs the database_id in config to act
// on a remote DB. To keep the one-click flow we DON'T pin an id in wrangler.jsonc
// (Cloudflare auto-provisions the DB by name on deploy), so we resolve the id
// here — the DB exists by now — and hand migrations apply a throwaway config
// carrying that id + the migrations dir. (The built dist config only has the
// name, which is why a bare apply failed with "missing a database_id".)
//
// For Postgres (DB_DRIVER="postgres") it is a no-op: a DB firewall locked to
// Cloudflare IP ranges often blocks CI runners, so run `npm run db:migrate`
// yourself from an allowed machine (see docs/DEPLOYMENT.md).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

let driver = "d1";
let dbName = "shortlink-db";
let migrationsDir = "drizzle/sqlite";
try {
  // The built config is plain JSON (no comments) — read the active driver + DB.
  const cfg = JSON.parse(readFileSync("dist/shortlink/wrangler.json", "utf8"));
  driver = cfg.vars?.DB_DRIVER ?? driver;
  const d1 = cfg.d1_databases?.[0];
  if (d1?.database_name) dbName = d1.database_name;
  if (d1?.migrations_dir) migrationsDir = d1.migrations_dir;
} catch {
  // No built config available — fall back to the defaults above.
}

if (driver !== "d1") {
  console.log(`[postdeploy] DB_DRIVER=${driver}: skipping D1 migrations.`);
  process.exit(0);
}

// Pull JSON out of wrangler's stdout (it may prefix a banner before the payload).
function parseJson(out) {
  const i = out.search(/[[{]/);
  if (i < 0) throw new Error("no JSON in output");
  return JSON.parse(out.slice(i));
}

// Resolve the (auto-provisioned) database_id by name.
console.log(`[postdeploy] Resolving database_id for "${dbName}"…`);
let databaseId;
try {
  const info = parseJson(
    execSync(`npx wrangler d1 info ${dbName} --json`, { encoding: "utf8" }),
  );
  databaseId = info.uuid ?? info.database_id ?? info.id;
} catch (e) {
  // Fall back to scanning the full list if `info` is unavailable.
  try {
    const list = parseJson(
      execSync(`npx wrangler d1 list --json`, { encoding: "utf8" }),
    );
    databaseId = (list.find((d) => d.name === dbName) || {}).uuid;
  } catch {
    console.error(`[postdeploy] could not resolve database id: ${e.message}`);
    process.exit(1);
  }
}
if (!databaseId) {
  console.error(`[postdeploy] no database_id found for "${dbName}".`);
  process.exit(1);
}

// Hand migrations apply a minimal config carrying the resolved id + dir.
const migrateCfg = "d1-migrate.generated.json";
writeFileSync(
  migrateCfg,
  JSON.stringify({
    name: "shortlink",
    d1_databases: [
      {
        binding: "DB",
        database_name: dbName,
        database_id: databaseId,
        migrations_dir: migrationsDir,
      },
    ],
  }),
);

console.log(
  `[postdeploy] Applying D1 migrations to "${dbName}" (${databaseId}) (--remote)…`,
);
execSync(`npx wrangler d1 migrations apply ${dbName} --remote -c ${migrateCfg}`, {
  stdio: "inherit",
});
