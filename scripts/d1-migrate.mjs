// Applies the D1 (drizzle/sqlite) migrations to the REMOTE database.
//
// `wrangler d1 migrations apply --remote` needs the database_id in config to act
// on a remote DB. The one-click flow deliberately leaves the id OUT of
// wrangler.jsonc so Cloudflare auto-provisions the DB by name on deploy — which
// makes a bare `wrangler d1 migrations apply shortlink-db --remote` fail with
// "missing a database_id". So we resolve the id by name here and hand migrations
// apply a throwaway config carrying that id + the migrations dir.
//
// Used by `npm run db:migrate:d1` and by scripts/postdeploy.mjs (after deploy).
// `migrations apply` is idempotent — already-applied migrations are skipped.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

let dbName = "shortlink-db";
let migrationsDir = "drizzle/sqlite";
try {
  // After a build the active driver/DB is in the built (comment-free) config.
  const cfg = JSON.parse(readFileSync("dist/shortlink/wrangler.json", "utf8"));
  const d1 = cfg.d1_databases?.[0];
  if (d1?.database_name) dbName = d1.database_name;
  if (d1?.migrations_dir) migrationsDir = d1.migrations_dir;
} catch {
  // No built config — fall back to the defaults above.
}

// Pull JSON out of wrangler's stdout (it may prefix a banner before the payload).
function parseJson(out) {
  const i = out.search(/[[{]/);
  if (i < 0) throw new Error("no JSON in output");
  return JSON.parse(out.slice(i));
}

console.log(`[d1-migrate] Resolving database_id for "${dbName}"…`);
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
    console.error(`[d1-migrate] could not resolve database id: ${e.message}`);
    process.exit(1);
  }
}
if (!databaseId) {
  console.error(`[d1-migrate] no database_id found for "${dbName}".`);
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
  `[d1-migrate] Applying D1 migrations to "${dbName}" (${databaseId}) (--remote)…`,
);
execSync(`npx wrangler d1 migrations apply ${dbName} --remote -c ${migrateCfg}`, {
  stdio: "inherit",
});
