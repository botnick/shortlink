/**
 * End-to-end test against a REAL Postgres via Hono's app.fetch(), mocking only
 * the Cloudflare KV + ASSETS bindings. Run: DBURL=... npx tsx tests/e2e.ts
 * Cleans up all rows at the end so the DB is left migrated-but-empty.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import app from "../worker/index";
import * as schema from "../worker/db/schema";

const DB_URL = process.env.DBURL!;
const BASE = "https://localhost"; // exercise the production code paths (CSP, __Host- cookie)

// --- mock bindings ----------------------------------------------------------
const kvStore = new Map<string, string>();
const LINKS_KV = {
  async get(key: string, type?: string) {
    const v = kvStore.get(key);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  },
  async put(key: string, value: string) {
    kvStore.set(key, value);
  },
  async delete(key: string) {
    kvStore.delete(key);
  },
};
const ASSETS = {
  async fetch() {
    return new Response("<!doctype html><div id=root></div>", {
      headers: { "content-type": "text/html" },
    });
  },
};
const env = {
  HYPERDRIVE: { connectionString: DB_URL },
  LINKS_KV,
  ASSETS,
  APP_URL: "https://localhost",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  SETUP_TOKEN: "correct-setup-token",
};

// --- assert harness ---------------------------------------------------------
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

// --- request helper ---------------------------------------------------------
interface Jar {
  cookie: string | null;
}
function setCookieFrom(res: Response, jar: Jar) {
  const all =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  if (!all.length) return;
  const pair = all[0].split(";")[0];
  const value = pair.split("=").slice(1).join("=");
  jar.cookie = value && value !== "" ? pair : null;
}

async function req(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    jar?: Jar;
    headers?: Record<string, string>;
  } = {},
) {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      tasks.push(Promise.resolve(p).catch(() => {}));
    },
    passThroughOnException: () => {},
  };
  const headers: Record<string, string> = {
    origin: BASE,
    ...opts.headers,
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.jar?.cookie) headers["cookie"] = opts.jar.cookie;

  const request = new Request(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });

  const res = await app.fetch(request, env as never, ctx as never);
  await Promise.allSettled(tasks); // flush waitUntil (click logging, KV writes, db close)
  if (opts.jar) setCookieFrom(res, opts.jar);

  const ct = res.headers.get("content-type") ?? "";
  const json = ct.includes("application/json") ? await res.clone().json() : null;
  return { res, json, status: res.status };
}

// --- run --------------------------------------------------------------------
const admin: Jar = { cookie: null };
const user2: Jar = { cookie: null };
let adminId = "";
let user2UserId = "";

async function main() {
  console.log("\n[1] Health + initial config");
  {
    const h = await req("GET", "/api/health");
    check("GET /api/health -> 200 {ok}", h.status === 200 && h.json?.ok === true, h.json);

    const c = await req("GET", "/api/config");
    check("config.needsSetup true on fresh DB", c.json?.needsSetup === true, c.json);
  }

  console.log("\n[2] Security headers (prod / https)");
  {
    const r = await req("GET", "/");
    const csp = r.res.headers.get("content-security-policy");
    const hsts = r.res.headers.get("strict-transport-security");
    check("CSP header present", !!csp && csp.includes("default-src 'self'"), csp);
    check("HSTS header present", !!hsts && hsts.includes("max-age"), hsts);
    check("X-Content-Type-Options nosniff", r.res.headers.get("x-content-type-options") === "nosniff");
    check("X-Frame-Options DENY", r.res.headers.get("x-frame-options") === "DENY");
  }

  console.log("\n[3] Setup installer");
  {
    const bad = await req("POST", "/api/setup", {
      body: { token: "wrong", appName: "X", email: "a@b.com", password: "password123", registrationEnabled: false },
    });
    check("setup wrong token -> 403", bad.status === 403, bad.json);

    const csrfless = await req("POST", "/api/setup", {
      body: { token: "correct-setup-token", appName: "X", email: "a@b.com", password: "password123", registrationEnabled: false },
      headers: { origin: "https://evil.example" },
    });
    check("setup bad Origin (CSRF) -> 403", csrfless.status === 403, csrfless.status);

    const ok = await req("POST", "/api/setup", {
      jar: admin,
      body: {
        token: "correct-setup-token",
        appName: "Test App",
        shortDomain: "links.example.com",
        email: "admin@example.test",
        password: "adminpassword123",
        registrationEnabled: false,
      },
    });
    check("setup -> 201 + admin user", ok.status === 201 && ok.json?.user?.role === "admin", ok.json);
    check("setup set session cookie", admin.cookie !== null);
    adminId = ok.json?.user?.id;

    const again = await req("POST", "/api/setup", {
      body: {
        token: "correct-setup-token",
        appName: "Hax",
        email: "hax@example.test",
        password: "password123",
        registrationEnabled: true,
      },
    });
    check("second setup -> 409 (locked)", again.status === 409, again.json);

    const c = await req("GET", "/api/config");
    check("config.needsSetup false after setup", c.json?.needsSetup === false, c.json);
    check("config.appName persisted", c.json?.appName === "Test App", c.json);
  }

  console.log("\n[4] Auth");
  {
    const me = await req("GET", "/api/auth/me", { jar: admin });
    check("me -> admin", me.json?.user?.email === "admin@example.test", me.json);

    const anon = await req("GET", "/api/auth/me");
    check("me (no cookie) -> null", anon.json?.user === null, anon.json);

    const badLogin = await req("POST", "/api/auth/login", {
      body: { email: "admin@example.test", password: "wrongpass" },
    });
    check("login wrong password -> 401", badLogin.status === 401, badLogin.json);

    const unknown = await req("POST", "/api/auth/login", {
      body: { email: "nobody@example.test", password: "whatever123" },
    });
    check("login unknown user -> 401 (generic)", unknown.status === 401, unknown.json);

    const noauth = await req("GET", "/api/links");
    check("GET /api/links without auth -> 401", noauth.status === 401, noauth.status);
  }

  console.log("\n[5] Links CRUD + validation");
  let linkId = "";
  let slug = "";
  {
    const created = await req("POST", "/api/links", {
      jar: admin,
      body: { destination: "https://example.com/landing-page", title: "Landing" },
    });
    check("create link -> 201", created.status === 201 && !!created.json?.link?.slug, created.json);
    linkId = created.json?.link?.id;
    slug = created.json?.link?.slug;

    const custom = await req("POST", "/api/links", {
      jar: admin,
      body: { destination: "https://example.com/custom", slug: "my-alias" },
    });
    check("create custom alias -> 201", custom.status === 201 && custom.json?.link?.slug === "my-alias", custom.json);

    const dup = await req("POST", "/api/links", {
      jar: admin,
      body: { destination: "https://example.com/dup", slug: "my-alias" },
    });
    check("duplicate alias -> 409", dup.status === 409, dup.json);

    const reserved = await req("POST", "/api/links", {
      jar: admin,
      body: { destination: "https://example.com/x", slug: "admin" },
    });
    check("reserved alias -> 400", reserved.status === 400, reserved.json);

    const badUrl = await req("POST", "/api/links", {
      jar: admin,
      body: { destination: "javascript:alert(1)" },
    });
    check("javascript: destination -> 400 (blocked)", badUrl.status === 400, badUrl.json);

    const list = await req("GET", "/api/links", { jar: admin });
    check("list links -> includes created", Array.isArray(list.json?.links) && list.json.links.length >= 2, list.json?.links?.length);
  }

  console.log("\n[6] Redirect hot path + click logging");
  {
    const r1 = await req("GET", `/${slug}`, {
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604",
        "cf-connecting-ip": "203.0.113.10",
        referer: "https://twitter.com/",
      },
    });
    check("redirect (KV miss) -> 302", r1.status === 302, r1.status);
    check("redirect Location correct", r1.res.headers.get("location") === "https://example.com/landing-page", r1.res.headers.get("location"));
    check("KV warmed after miss", kvStore.has(`link:${slug}`));

    const r2 = await req("GET", `/${slug}`, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537",
        "cf-connecting-ip": "203.0.113.20",
      },
    });
    check("redirect (KV hit) -> 302", r2.status === 302, r2.status);

    const r3 = await req("GET", `/${slug}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120", "cf-connecting-ip": "203.0.113.20" },
    });
    check("third redirect -> 302", r3.status === 302);

    const missing = await req("GET", "/no-such-slug");
    check("unknown slug -> 404 (SPA)", missing.status === 404, missing.status);
  }

  console.log("\n[7] Stats");
  {
    const stats = await req("GET", `/api/links/${linkId}/stats?range=all`, { jar: admin });
    check("stats total clicks = 3", stats.json?.totalClicks === 3, stats.json?.totalClicks);
    check("stats unique visitors = 2", stats.json?.uniqueVisitors === 2, stats.json?.uniqueVisitors);
    check("stats timeseries present", Array.isArray(stats.json?.timeseries) && stats.json.timeseries.length >= 1, stats.json?.timeseries);
    const devices: { name: string }[] = stats.json?.devices ?? [];
    check("stats devices include mobile + desktop", devices.some((d) => d.name === "mobile") && devices.some((d) => d.name === "desktop"), devices);
    const browsers: { name: string }[] = stats.json?.browsers ?? [];
    check("stats browsers include Chrome", browsers.some((b) => b.name === "Chrome"), browsers);
    const refs: { name: string }[] = stats.json?.referrers ?? [];
    check("stats referrers include twitter", refs.some((r) => r.name.includes("twitter")), refs);
  }

  console.log("\n[8] Update / deactivate / delete");
  {
    const upd = await req("PATCH", `/api/links/${linkId}`, {
      jar: admin,
      body: { destination: "https://example.com/updated", isActive: false },
    });
    check("patch link -> 200", upd.status === 200 && upd.json?.link?.destination === "https://example.com/updated", upd.json);

    const inactive = await req("GET", `/${slug}`);
    check("deactivated link -> 410", inactive.status === 410, inactive.status);

    const del = await req("DELETE", `/api/links/${linkId}`, { jar: admin });
    check("delete link -> 200", del.status === 200, del.json);

    const gone = await req("GET", `/${slug}`);
    check("deleted link -> 404", gone.status === 404, gone.status);
  }

  console.log("\n[9] Admin + registration + IDOR");
  {
    const s = await req("GET", "/api/admin/settings", { jar: admin });
    check("admin settings readable", s.json?.registrationEnabled === false, s.json);

    const open = await req("PATCH", "/api/admin/settings", { jar: admin, body: { registrationEnabled: true } });
    check("admin opens registration", open.json?.registrationEnabled === true, open.json);

    const reg = await req("POST", "/api/auth/register", {
      jar: user2,
      body: { email: "user2@example.test", password: "user2password" },
    });
    check("register user2 (now open) -> 201", reg.status === 201, reg.json);
    user2UserId = reg.json?.user?.id;

    // user2 makes a link
    const u2link = await req("POST", "/api/links", { jar: user2, body: { destination: "https://example.com/u2" } });
    const u2id = u2link.json?.link?.id;
    check("user2 creates link -> 201", u2link.status === 201, u2link.json);

    // admin (different owner) viewing user2 link stats: admin IS allowed (owner-or-admin)
    const adminViewsU2 = await req("GET", `/api/links/${u2id}/stats?range=all`, { jar: admin });
    check("admin can view any link stats", adminViewsU2.status === 200, adminViewsU2.status);

    // user2 viewing a non-owned (admin's deleted) link -> 404; and admin endpoints -> 403
    const u2Admin = await req("GET", "/api/admin/settings", { jar: user2 });
    check("user2 hitting /admin -> 403", u2Admin.status === 403, u2Admin.status);

    // IDOR: user2 tries to read someone else's link by random id -> 404
    const idor = await req("GET", `/api/links/00000000-0000-0000-0000-000000000000/stats`, { jar: user2 });
    check("IDOR random id -> 404", idor.status === 404, idor.status);

    // --- team management + primary protection ---
    const teamList = await req("GET", "/api/admin/users", { jar: admin });
    check(
      "setup admin is primary",
      teamList.json?.users?.find((u: { id: string; isPrimary: boolean }) => u.id === adminId)?.isPrimary === true,
    );
    const promote = await req("PATCH", `/api/admin/users/${user2UserId}`, {
      jar: admin,
      body: { role: "admin" },
    });
    check("promote user2 to admin -> 200", promote.status === 200, promote.json);
    const demotePrimary = await req("PATCH", `/api/admin/users/${adminId}`, {
      jar: admin,
      body: { role: "user" },
    });
    check("can't demote primary admin -> 403", demotePrimary.status === 403, demotePrimary.json);
    const delPrimary = await req("DELETE", `/api/admin/users/${adminId}`, { jar: admin });
    check("can't delete primary admin -> 400/403", delPrimary.status === 400 || delPrimary.status === 403, delPrimary.status);
    const demote = await req("PATCH", `/api/admin/users/${user2UserId}`, {
      jar: admin,
      body: { role: "user" },
    });
    check("demote user2 -> 200", demote.status === 200, demote.json);
    const delU2 = await req("DELETE", `/api/admin/users/${user2UserId}`, { jar: admin });
    check("delete user2 -> 200", delU2.status === 200, delU2.json);

    const logout = await req("POST", "/api/auth/logout", { jar: admin });
    check("logout -> 200", logout.status === 200, logout.status);
    const afterLogout = await req("GET", "/api/auth/me", { jar: admin });
    check("after logout me -> null", afterLogout.json?.user === null, afterLogout.json);
  }
}

async function cleanup() {
  const sql = postgres(DB_URL, { max: 1, prepare: false });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  try {
    await db.delete(schema.clicks);
    await db.delete(schema.sessions);
    await db.delete(schema.links);
    await db.delete(schema.users);
    await db.delete(schema.settings);
    const [{ c: u }] = await sql`select count(*)::int as c from users`;
    const [{ c: s }] = await sql`select count(*)::int as c from settings`;
    console.log(`\n[cleanup] users=${u} settings=${s} (DB left migrated + empty)`);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("HARNESS ERROR:", e);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e));
    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    process.exit(fail === 0 ? 0 : 1);
  });
