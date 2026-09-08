/**
 * Dev/ops helper: mint an API key on a D1 deployment and print it once, so a
 * headless/fleet install can create its first key without the dashboard.
 * (Postgres deployments use scripts/seed-api-key.ts instead.)
 *
 *   node scripts/seed-api-key-d1.mjs <email> [name] [--local]
 *
 * Talks to the D1 database bound as DB in wrangler.jsonc (shortlink-db) via
 * `wrangler d1 execute`. Default is --remote (production); pass --local for the
 * local dev DB. Create the admin user at /setup first.
 *
 * wrangler.jsonc deliberately omits database_id (one-click auto-provisions by
 * name), so `--remote` needs the id resolved into a throwaway config — the same
 * dance as scripts/d1-migrate.mjs. --local needs no id.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const DB = "shortlink-db";
const args = process.argv.slice(2);
const local = args.includes("--local");
const [email, name = "fleet"] = args.filter((a) => !a.startsWith("--"));
if (!email) {
  console.error("usage: node scripts/seed-api-key-d1.mjs <email> [name] [--local]");
  process.exit(1);
}

let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || undefined;
try {
  const cfg = JSON.parse(readFileSync("dist/shortlink/wrangler.json", "utf8"));
  if (!accountId && cfg.account_id) accountId = cfg.account_id;
} catch {
  /* no built config — rely on wrangler's own account context */
}
const env = accountId ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId } : process.env;
const wrangler = (a) => execFileSync("npx", ["wrangler", ...a], { encoding: "utf8", env });
const parseJson = (out) => {
  const i = out.search(/[[{]/);
  if (i < 0) throw new Error("no JSON in wrangler output");
  return JSON.parse(out.slice(i));
};

// For --remote, resolve the database_id and hand execute a throwaway config.
let cfgFlag = [];
let cleanup = () => {};
if (!local) {
  const idOf = (d) => d?.uuid ?? d?.id ?? d?.database_id;
  let databaseId;
  try {
    databaseId = idOf(parseJson(wrangler(["d1", "info", DB, "--json"])));
  } catch {
    const list = parseJson(wrangler(["d1", "list", "--json"]));
    const arr = Array.isArray(list) ? list : (list?.result ?? list?.databases ?? []);
    databaseId = idOf(arr.find((d) => d.name === DB) || {});
  }
  if (!databaseId) {
    console.error(`Could not resolve database_id for "${DB}" (wrangler login / CLOUDFLARE_ACCOUNT_ID?).`);
    process.exit(1);
  }
  const file = "d1-seed.generated.json";
  const gen = { name: "shortlink", d1_databases: [{ binding: "DB", database_name: DB, database_id: databaseId }] };
  if (accountId) gen.account_id = accountId;
  writeFileSync(file, JSON.stringify(gen));
  cfgFlag = ["-c", file];
  cleanup = () => { try { rmSync(file); } catch { /* ignore */ } };
}

const scope = local ? "--local" : "--remote";
const esc = (s) => String(s).replace(/'/g, "''");
const exec = (sql) => parseJson(wrangler(["d1", "execute", DB, scope, ...cfgFlag, "--json", "--command", sql]));

try {
  const found = exec(`select id from users where lower(email) = lower('${esc(email)}') limit 1`);
  const rows = found?.[0]?.results ?? [];
  if (rows.length === 0) {
    console.error(`No user with email ${email}. Create the admin at /setup first.`);
    process.exit(1);
  }
  const userId = rows[0].id;

  const key = `sk_${randomBytes(24).toString("hex")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 11); // "sk_" + 8 chars
  const id = randomUUID();
  const nowSec = Math.floor(Date.now() / 1000); // api_keys.created_at = integer(timestamp) seconds

  exec(
    `insert into api_keys (id, user_id, name, key_hash, prefix, created_at) ` +
      `values ('${id}','${esc(userId)}','${esc(name)}','${keyHash}','${prefix}',${nowSec})`,
  );
  console.log(`API key for ${email} ("${name}"):\n${key}\n(store it now — only its SHA-256 is kept)`);
} finally {
  cleanup();
}
