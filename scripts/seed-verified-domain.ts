/**
 * Dev helper: insert a *verified* custom domain for a user so the domain picker
 * in the link editor has something to show. The domain isn't actually connected
 * via Cloudflare, so links created on it won't resolve — it's for trying the UI.
 *
 *   npx tsx scripts/seed-verified-domain.ts <email> <hostname>
 */
import { randomUUID } from "node:crypto";
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
const hostname = (process.argv[3] ?? "go.example.com").toLowerCase();

const sql = postgres(url, { prepare: false });
try {
  const [user] = await sql`
    select id, email from users where lower(email) = lower(${email}) limit 1
  `;
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  const token = randomUUID().replace(/-/g, "");
  const [row] = await sql`
    insert into domains (user_id, hostname, status, verify_token, verified_at)
    values (${user.id}, ${hostname}, 'verified', ${token}, now())
    on conflict (hostname) do update set status = 'verified', verified_at = now()
    returning id, hostname, status
  `;
  console.log(`Seeded domain for ${user.email}:`, row);
} finally {
  await sql.end();
}
