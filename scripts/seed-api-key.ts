/**
 * Dev helper: mint an API key for a user and print it (for trying the API).
 *
 *   npx tsx scripts/seed-api-key.ts <email> [name]
 */
import { createHash, randomBytes } from "node:crypto";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".dev.vars" });
loadEnv({ path: ".env" });

const url =
  process.env.DATABASE_URL ??
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;
if (!url) {
  console.error("Set DATABASE_URL (or the Hyperdrive local conn) in .dev.vars");
  process.exit(1);
}

const email = process.argv[2] ?? "botnick.xxx@gmail.com";
const name = process.argv[3] ?? "dev test";

const key = `sk_${randomBytes(24).toString("hex")}`;
const keyHash = createHash("sha256").update(key).digest("hex");
const prefix = key.slice(0, 11);

const sql = postgres(url, { prepare: false });
try {
  const [user] = await sql`
    select id, email from users where lower(email) = lower(${email}) limit 1
  `;
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  await sql`
    insert into api_keys (user_id, name, key_hash, prefix)
    values (${user.id}, ${name}, ${keyHash}, ${prefix})
  `;
  console.log(`API key for ${user.email} ("${name}"):\n${key}`);
} finally {
  await sql.end();
}
