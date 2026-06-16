/**
 * Throwaway DEV-ONLY admin for local UI previews/screenshots. Creates an admin
 * user you can log in as, then deletes it (cascading its sessions) when done.
 * Never run against production.
 *
 *   npx tsx scripts/dev-preview-admin.ts create
 *   npx tsx scripts/dev-preview-admin.ts delete
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { hashPassword } from "../worker/lib/password";

loadEnv({ path: ".dev.vars" });
loadEnv({ path: ".env" });

const EMAIL = "dev-preview@local.test";
const PASSWORD = "DevPreview!2026";

// Prefer the Hyperdrive Postgres conn; DATABASE_URL may be shadowed by an
// unrelated value in the surrounding shell, so only use it if it's a pg URL.
const dbEnv = process.env.DATABASE_URL;
const url =
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
  (dbEnv && /^postgres(ql)?:\/\//.test(dbEnv) ? dbEnv : undefined);
const secret = process.env.SESSION_SECRET;
if (!url || !secret) {
  console.error("Need DATABASE_URL/Hyperdrive conn + SESSION_SECRET in .dev.vars");
  process.exit(1);
}

const action = process.argv[2] ?? "create";
const sql = postgres(url, { prepare: false });
try {
  if (action === "delete") {
    const r = await sql`delete from users where email = ${EMAIL}`;
    console.log(`deleted ${r.count} row(s) for ${EMAIL}`);
  } else {
    const passwordHash = await hashPassword(PASSWORD, secret, 20_000);
    await sql`
      insert into users (email, password_hash, role)
      values (${EMAIL}, ${passwordHash}, 'admin')
      on conflict (email) do update
        set password_hash = excluded.password_hash, role = 'admin', deleted_at = null
    `;
    console.log(`admin ready:\n  email: ${EMAIL}\n  password: ${PASSWORD}`);
  }
} finally {
  await sql.end();
}
