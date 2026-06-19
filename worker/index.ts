import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { and, eq, lt, notInArray, sql } from "drizzle-orm";
import type { AppContext, AppEnv, AppBindings } from "./env";
import { getDbHandle } from "./db";
import { isRateLimited } from "./lib/ratelimit";
import {
  authRateLimitFrom,
  domainUnverifiedDaysFrom,
  getAllSettings,
  saasConfigFrom,
} from "./lib/settings";
import { deleteCustomHostname } from "./lib/cloudflare";
import { dbMiddleware } from "./middleware/db";
import { apiKeyAuth, loadSession } from "./middleware/auth";
import { requireSameOrigin, securityHeaders } from "./middleware/security";
import authRoutes, { AUTH_WINDOW_SEC } from "./routes/auth";
import captchaRoutes from "./routes/captcha";
import linkRoutes from "./routes/links";
import adminRoutes from "./routes/admin";
import setupRoutes from "./routes/setup";
import qrPresetRoutes from "./routes/qr-presets";
import assetRoutes from "./routes/assets";
import domainRoutes from "./routes/domains";
import projectRoutes from "./routes/projects";
import keyRoutes from "./routes/keys";
import accountRoutes from "./routes/account";
import { purgeDeletedAccounts } from "./lib/accountLifecycle";
import { purgeOldClicks } from "./lib/clicksRetention";
import { purgeHumanRecords } from "./lib/captcha/store";
import { handleMcp } from "./mcp";
import { getCachedPublicConfig, shortOrigin } from "./lib/appconfig";
import { interstitialPage, linkErrorPage, passwordPage } from "./lib/brandPages";
import { getCachedLink, putCachedLink, routeDestination } from "./lib/cache";
import { cachePayload } from "./lib/linkCache";
import { buildShortUrl, findLinkRow, resolveScope } from "./lib/domainScope";
import {
  getSeoBundle,
  injectSeo,
  robotsTxt,
  serveBrandImage,
  sitemapXml,
} from "./lib/seo";
import { isValidCustomSlug } from "./lib/slug";
import { destinationPreview, isCrawler, previewHtml } from "./lib/social";
import { verifyPassword } from "./lib/password";
import { assertSessionSecret } from "./lib/secret";
import { qrSvg } from "./lib/qrsvg";
import {
  getClientIp,
  getCountry,
  getReferrer,
  hashIp,
  isBotUA,
  parseUserAgent,
} from "./lib/geo";

const app = new Hono<AppEnv>();

// Refuse to serve with a weak/missing SESSION_SECRET (memoised: once per isolate).
// Runs before anything that signs cookies or hashes with it.
app.use("*", async (c, next) => {
  assertSessionSecret(c.env.SESSION_SECRET);
  await next();
});

// Security headers on every response (incl. the SPA and redirects).
app.use("*", securityHeaders);

// --- JSON API ---------------------------------------------------------------
const api = new Hono<AppEnv>();
api.use("*", dbMiddleware);
// CSRF protections guard cookie-based sessions. Bearer-key requests are
// CSRF-immune by construction (a browser can't attach the header cross-site),
// and non-browser clients often omit Content-Type/Origin — so they skip these
// two checks and authenticate via apiKeyAuth instead.
const csrfMw = csrf();
api.use("*", (c, next) =>
  c.req.header("authorization")?.startsWith("Bearer ") ? next() : csrfMw(c, next),
);
api.use("*", (c, next) =>
  c.req.header("authorization")?.startsWith("Bearer ")
    ? next()
    : requireSameOrigin(c, next),
);
api.use("*", loadSession);
// Bearer API-key auth (the public API). Hono's csrf() only inspects form
// content types and requireSameOrigin allows requests without an Origin, so
// JSON+Bearer clients pass both untouched.
api.use("*", apiKeyAuth);
api.route("/auth", authRoutes);
api.route("/captcha", captchaRoutes);
api.route("/links", linkRoutes);
api.route("/admin", adminRoutes);
api.route("/setup", setupRoutes);
api.route("/qr-presets", qrPresetRoutes);
api.route("/assets", assetRoutes);
api.route("/domains", domainRoutes);
api.route("/projects", projectRoutes);
api.route("/keys", keyRoutes);
api.route("/account", accountRoutes);
// Versioned aliases for the public API — same handlers, stable paths.
api.route("/v1/links", linkRoutes);
api.route("/v1/domains", domainRoutes);
api.route("/v1/projects", projectRoutes);

// Public, cacheable endpoints — registered before the API group so they skip the
// per-request DB client + auth/CSRF middleware entirely. /config is served from
// KV (no DB round-trip on a hit), which is the hottest endpoint under traffic.
app.get("/api/config", async (c) => c.json(await getCachedPublicConfig(c.env)));
app.get("/api/health", (c) => c.json({ ok: true }));

// Public QR payload for the standalone `/qr/<slug>` page (anyone can open it,
// like lnk.ua/qr/…). Active links only, and it returns nothing the redirect
// doesn't already reveal: the short URL plus the project's brand colour/logo.
app.get("/api/qr/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isValidCustomSlug(slug)) return c.json({ error: "Not found" }, 404);
  const scope = await resolveScope(c, c.req.header("host"));
  const { db, schema, close } = getDbHandle(c.env);
  const { projects } = schema;
  try {
    const l = await findLinkRow(db, schema, scope.domainId, slug);
    const expired = l?.expiresAt ? l.expiresAt.getTime() <= Date.now() : false;
    if (!l || !l.isActive || expired) return c.json({ error: "Not found" }, 404);
    const p = l.projectId
      ? (
          await db
            .select({ color: projects.color, logo: projects.logo })
            .from(projects)
            .where(eq(projects.id, l.projectId))
            .limit(1)
        )[0]
      : undefined;
    const logo =
      p?.logo && (p.logo.startsWith("data:") || p.logo.startsWith("http"))
        ? p.logo
        : null;
    return c.json(
      {
        shortUrl: buildShortUrl(
          await shortOrigin(c.env),
          scope.domainId ? scope.host : null,
          l.slug,
        ),
        color: p?.color ?? null,
        logo,
        qrConfig: l.qrConfig ?? null,
      },
      200,
      { "cache-control": "public, max-age=300" },
    );
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

// Public unlock for password-protected links: verify the password, then 302 to
// the (per-OS) destination, or re-render the prompt with an error. PBKDF2 makes
// brute force slow; the no-JS form posts here from the unlock page.
app.post("/api/unlock/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isValidCustomSlug(slug)) return linkErrorPage(c, "not-found");
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  const scope = await resolveScope(c, c.req.header("host"));
  const { db, schema, close } = getDbHandle(c.env);
  try {
    // Throttle online password guessing: the no-JS unlock page has no human
    // check, so a per-IP rate limit is its only brake (reuses the admin
    // auth-rate-limit setting; 15-min window like login).
    const map = await getAllSettings(db, schema);
    if (await isRateLimited(c.env, `unlock:${getClientIp(c)}`, authRateLimitFrom(map), AUTH_WINDOW_SEC)) {
      return linkErrorPage(c, "rate-limited");
    }
    const l = await findLinkRow(db, schema, scope.domainId, slug);
    if (!l) return linkErrorPage(c, "not-found");
    if (!l.isActive) return linkErrorPage(c, "disabled");
    if (l.expiresAt && l.expiresAt.getTime() <= Date.now()) {
      return linkErrorPage(c, "expired");
    }
    if (l.passwordHash && !(await verifyPassword(password, l.passwordHash, c.env.SESSION_SECRET))) {
      return passwordPage(c, slug, "Incorrect password. Try again.");
    }
    c.executionCtx.waitUntil(logClick(c, l.id));
    const { os, deviceType } = parseUserAgent(c.req.header("user-agent") ?? null);
    const target = routeDestination(
      {
        id: l.id,
        destination: l.destination,
        iosUrl: l.iosUrl,
        androidUrl: l.androidUrl,
        desktopUrl: l.desktopUrl,
        isActive: l.isActive,
        hasPassword: true,
        expiresAt: null,
      },
      os,
      deviceType,
    );
    return new Response(null, {
      status: 302,
      headers: { Location: target, "Cache-Control": "private, no-store" },
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

app.route("/api", api);

// Remote MCP server (context7-style): agents connect to /mcp with their API
// key as a Bearer token. Tool calls dispatch back through /api/v1 internally,
// inheriting auth, validation, rate limits and the admin switches.
app.all("/mcp", (c) =>
  handleMcp(c, async (req) => app.fetch(req, c.env, c.executionCtx)),
);

// --- Dynamic branding / SEO endpoints ---------------------------------------
app.get("/robots.txt", async (c) =>
  c.text(await robotsTxt(c.env), 200, { "cache-control": "public, max-age=3600" }),
);
app.get("/sitemap.xml", async (c) =>
  c.body(await sitemapXml(c.env), 200, {
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "public, max-age=3600",
  }),
);
app.get("/icon", (c) => serveBrandImage(c.env, "icon"));
app.get("/og", (c) => serveBrandImage(c.env, "og"));
// Public, content-addressed brand images (logo / OG) stored in R2. The sha in the
// path makes the bytes immutable, so they cache forever — this is what /api/config
// and the SPA point at instead of shipping a ~100KB base64 data: URI.
app.get("/brand/:kind/:sha", async (c) => {
  const kind = c.req.param("kind");
  const sha = c.req.param("sha");
  if ((kind !== "logo" && kind !== "og") || !/^[a-f0-9]{64}$/.test(sha)) {
    return c.notFound();
  }
  const obj = await c.env.LOGO_BUCKET.get(`brand/${kind}/${sha}`);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${sha}"`,
      "x-content-type-options": "nosniff",
    },
  });
});
// Public per-link OG image (so social crawlers can fetch a real URL).
app.get("/ogimg/:id", (c) => serveLinkOgImage(c, c.req.param("id")));

// Direct QR image: /qr/<slug>.svg returns a scannable, brand-coloured SVG that
// can be embedded or shared anywhere. The bare /qr/<slug> stays the HTML page.
app.get("/qr/:file", async (c) => {
  const file = c.req.param("file");
  const m = /^([a-zA-Z0-9_-]{3,32})\.svg$/.exec(file);
  if (!m) return serveAssets(c); // not a .svg request → serve the SPA page
  const slug = m[1];
  const scope = await resolveScope(c, c.req.header("host"));
  const { db, schema, close } = getDbHandle(c.env);
  const { projects } = schema;
  try {
    const l = await findLinkRow(db, schema, scope.domainId, slug);
    const expired = l?.expiresAt ? l.expiresAt.getTime() <= Date.now() : false;
    if (!l || !l.isActive || expired) return linkErrorPage(c, "not-found");
    const projectLogo = l.projectId
      ? (
          await db
            .select({ logo: projects.logo })
            .from(projects)
            .where(eq(projects.id, l.projectId))
            .limit(1)
        )[0]?.logo ?? null
      : null;
    // Reflect the saved design's colours + logo (the server can't reproduce
    // qr-code-styling's gradients/frames, but matches the common case).
    const qc = (l.qrConfig as Record<string, unknown> | null) ?? {};
    const hex = (v: unknown, fb: string) =>
      typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fb;
    const fg = hex(qc.fg, "#000000");
    const corner = hex(qc.cornerSquareColor, fg);
    const logo = qc.logo && typeof qc.logoSrc === "string" ? qc.logoSrc : projectLogo;
    const shortUrl = buildShortUrl(
      await shortOrigin(c.env),
      scope.domainId ? scope.host : null,
      l.slug,
    );
    return c.body(qrSvg(shortUrl, { fg, brand: corner, logo }), 200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

// --- Redirect hot path ------------------------------------------------------
app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  // Only well-formed, non-reserved slugs get a DB lookup. Everything else —
  // app routes, /favicon.ico, and dev module paths like /@react-refresh — is an asset.
  if (!isValidCustomSlug(slug)) return serveAssets(c);

  // Which domain does this host map to? The same slug can exist on several
  // hosts, so every lookup is scoped to one domain bucket.
  const scope = await resolveScope(c, c.req.header("host"));

  // Social crawlers (FB/X/IG/Slack/…) get an OG-tagged preview instead of the
  // redirect, so a shared link can show a branded card. Bots don't run JS and
  // aren't counted as clicks; humans always fall through to the fast path.
  if (isCrawler(c.req.header("user-agent") ?? null)) {
    try {
      const preview = await serveSocialPreview(c, scope.domainId, slug);
      if (preview) return preview;
    } catch {
      // Preview unavailable (DB/KV blip) → fall through to the normal redirect.
    }
  }

  const kv = c.env.LINKS_KV;
  let cached = await getCachedLink(kv, scope.domainId, slug);

  // KV miss → the database is the source of truth; warm the cache for next time.
  // findLinkRow also follows a retired alias to its live link (old links work).
  if (!cached) {
    const { db, schema, close } = getDbHandle(c.env);
    try {
      const row = await findLinkRow(db, schema, scope.domainId, slug);
      if (row) {
        cached = cachePayload(row);
        c.executionCtx.waitUntil(putCachedLink(kv, scope.domainId, slug, cached));
      }
    } catch {
      // DB unavailable — a cached link would still have served (KV hit above);
      // an uncached one can't be resolved now, so degrade to the branded
      // not-found page below rather than 500ing the redirect.
    } finally {
      c.executionCtx.waitUntil(close());
    }
  }

  if (!cached) return linkErrorPage(c, "not-found");
  if (!cached.isActive) return linkErrorPage(c, "disabled");
  if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
    return linkErrorPage(c, "expired");
  }

  // Password-gated links: show the unlock prompt instead of forwarding. The
  // click is counted on a successful unlock (in /api/unlock), not here.
  if (cached.hasPassword) return passwordPage(c, slug);

  // Per-OS deep-link routing (iOS / Android / desktop), resolved on the cached
  // payload so it stays on the edge with no extra DB read.
  const { os, deviceType } = parseUserAgent(c.req.header("user-agent") ?? null);
  const target = routeDestination(cached, os, deviceType);

  // Optional link-safety interstitial: confirm before forwarding to an external
  // site. The toggle is read from the 30s-memoised public config (no per-redirect
  // KV read on a warm isolate); the Continue link re-requests with ?go=1 to skip
  // the gate, so the click is logged once — on the real forward, not the gate.
  if (c.req.query("go") !== "1") {
    const cfg = await getCachedPublicConfig(c.env);
    if (cfg.safetyInterstitial) {
      let host = target;
      try {
        host = new URL(target).hostname;
      } catch {
        // non-URL destination → show it as-is
      }
      return interstitialPage(c, slug, host);
    }
  }

  // Log the click off the response path so the redirect stays instant.
  c.executionCtx.waitUntil(logClick(c, cached.id));
  // 302 (not 301) + no-store: never let a browser/proxy cache the hop. This is
  // the deliberate opposite of the big shorteners' cacheable 301 — it guarantees
  // every click reaches us (so analytics are complete) and a destination edit
  // takes effect on the very next click instead of being frozen by a cache.
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "private, no-store",
    },
  });
});

// --- SPA fallback for everything else ---------------------------------------
app.all("*", (c) => serveAssets(c));

app.onError((err, c) => {
  // Middleware (csrf, validators) signals intent via HTTPException — keep the
  // real status instead of masking everything as a 500.
  if (err instanceof HTTPException) {
    if (err.status === 403) {
      return c.json({ error: "Cross-origin request blocked" }, 403);
    }
    return err.getResponse();
  }
  console.error("Unhandled error:", err);
  // A non-API (redirect / page) request gets the branded error page; the API
  // gets JSON. Fall back to a bare 500 only if even the branded page can't render.
  if (!new URL(c.req.url).pathname.startsWith("/api")) {
    return linkErrorPage(c, "error").catch(() =>
      c.json({ error: "Internal Server Error" }, 500),
    );
  }
  // Local dev only (plain http): surface the message so failures are
  // debuggable from curl. Production (always https) stays generic.
  if (new URL(c.req.url).protocol === "http:") {
    return c.json(
      { error: "Internal Server Error", detail: String(err) },
      500,
    );
  }
  return c.json({ error: "Internal Server Error" }, 500);
});

/**
 * Copy the assets response into a fresh Response so downstream middleware
 * (security headers) can mutate headers — a fetched Response has immutable headers.
 */
async function serveAssets(c: AppContext): Promise<Response> {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const out = new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
  // Inject branding + SEO meta into the SPA shell for crawlers & social unfurls.
  // The pathname drives the per-route canonical / og:url.
  if (out.headers.get("content-type")?.includes("text/html")) {
    return injectSeo(out, await getSeoBundle(c.env), c.req.path);
  }
  return out;
}

/**
 * For social crawlers: return an OG-card HTML when the link opts into a preview,
 * else null (so the caller continues to the normal redirect path). Does a DB
 * lookup — fine because crawler hits are infrequent (once per share).
 */
async function serveSocialPreview(
  c: AppContext,
  domainId: string | null,
  slug: string,
): Promise<Response | null> {
  const { db, schema, close } = getDbHandle(c.env);
  try {
    const l = await findLinkRow(db, schema, domainId, slug);
    if (!l) return null;
    const expired = l.expiresAt ? l.expiresAt.getTime() <= Date.now() : false;
    if (!l.isActive || expired || l.previewMode === "off") return null;

    // Crawlers need an ABSOLUTE og:image on the real short domain — never the
    // APP_URL placeholder. /ogimg/:id is served on the canonical short origin.
    const ogOrigin = await shortOrigin(c.env);

    let preview;
    if (l.previewMode === "destination") {
      preview = await destinationPreview(c.env, l.id, l.destination);
      // If the destination exposes no image, fall back to the branded card we
      // baked at create time (stored like a custom image, served from R2) so the
      // shared card still looks designed instead of bare.
      if (!preview.image && l.ogImage) {
        preview.image = l.ogImage.startsWith("http")
          ? l.ogImage
          : `${ogOrigin}/ogimg/${l.id}`;
      }
    } else {
      // og:image must be a public URL (social ignores data: URLs). A custom
      // image lives in R2 ("r2") and is served via the public /ogimg/:id endpoint.
      const image = l.ogImage
        ? l.ogImage.startsWith("http")
          ? l.ogImage
          : `${ogOrigin}/ogimg/${l.id}`
        : "";
      preview = {
        title: l.ogTitle ?? "",
        description: l.ogDescription ?? "",
        image,
      };
    }
    if (!preview.title) preview.title = l.slug;
    const bundle = await getSeoBundle(c.env);
    // og:url = this short link (the page being shared) so the card is credited to
    // us; the destination is only used for the redirect fallback inside the HTML.
    // For a locked link, point the HTML fallback at the short URL (the unlock
    // page), never the destination — so the protected URL can't leak via source.
    return c.html(
      previewHtml(preview, l.passwordHash ? c.req.url : l.destination, bundle.appName, c.req.url),
    );
  } finally {
    c.executionCtx.waitUntil(close());
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Serve a link's custom OG image bytes publicly from R2 (keyed by link id). */
async function serveLinkOgImage(c: AppContext, id: string): Promise<Response> {
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });
  const { db, schema, close } = getDbHandle(c.env);
  const { links } = schema;
  try {
    const rows = await db
      .select({ ogImage: links.ogImage })
      .from(links)
      .where(eq(links.id, id))
      .limit(1);
    const src = rows[0]?.ogImage ?? "";
    if (src.startsWith("http")) return Response.redirect(src, 302);
    // Custom OG images are stored as a blob in R2 (keyed by link id), not in the DB.
    if (src !== "r2") return new Response("Not found", { status: 404 });
    const obj = await c.env.LOGO_BUCKET.get(`og/${id}`);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
        "cache-control": "public, max-age=86400",
        // Don't let a stored blob be sniffed into an executable type (only raster
        // MIMEs are accepted on write — this is the second layer).
        "x-content-type-options": "nosniff",
      },
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
}

async function logClick(c: AppContext, linkId: string): Promise<void> {
  const { db, schema, close } = getDbHandle(c.env);
  const { clicks, links } = schema;
  try {
    const ua = c.req.header("user-agent") ?? null;
    const { browser, os, deviceType } = parseUserAgent(ua);
    // Bot/automation traffic is recorded (for auditing) but kept out of the
    // denormalized counter so dashboards and analytics agree on human clicks.
    const isBot = isBotUA(ua);
    await Promise.all([
      db.insert(clicks).values({
        linkId,
        country: getCountry(c),
        referrer: getReferrer(c),
        browser,
        os,
        deviceType,
        // Salted hash to count unique visitors — the raw IP is never stored.
        ipHash: await hashIp(getClientIp(c), c.env.SESSION_SECRET),
        isBot,
      }),
      isBot
        ? Promise.resolve()
        : db
            .update(links)
            .set({ clickCount: sql`${links.clickCount} + 1` })
            .where(eq(links.id, linkId)),
    ]);
  } catch (err) {
    console.error("logClick failed:", err);
  } finally {
    await close();
  }
}

/** Cron: remove custom domains left unverified past the configured window
 *  (admin setting `domainUnverifiedDays`, default 90; 0 disables). Releases the
 *  Cloudflare-for-SaaS hostname too. Users are warned in-app via a countdown. */
async function cleanupUnverifiedDomains(env: AppBindings): Promise<void> {
  const { db, schema, close } = getDbHandle(env);
  try {
    const settings = await getAllSettings(db, schema);
    const days = domainUnverifiedDaysFrom(settings);
    if (days <= 0) return;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const { domains } = schema;
    const stale = await db
      .select({ id: domains.id, cfHostnameId: domains.cfHostnameId })
      .from(domains)
      .where(
        and(
          // Anything that never reached a done state (active = SaaS, verified =
          // DNS). Catches every stuck Cloudflare status — pending_validation,
          // pending_deployment, blocked, … — not just the literal "pending".
          notInArray(domains.status, ["active", "verified"]),
          lt(domains.createdAt, cutoff),
        ),
      );
    if (stale.length === 0) return;
    const saas = await saasConfigFrom(settings, env.APP_URL, env.SESSION_SECRET);
    if (saas) {
      for (const d of stale) {
        if (d.cfHostnameId) {
          await deleteCustomHostname(saas, d.cfHostnameId).catch(() => {});
        }
      }
    }
    await db
      .delete(domains)
      .where(
        and(
          // Anything that never reached a done state (active = SaaS, verified =
          // DNS). Catches every stuck Cloudflare status — pending_validation,
          // pending_deployment, blocked, … — not just the literal "pending".
          notInArray(domains.status, ["active", "verified"]),
          lt(domains.createdAt, cutoff),
        ),
      );
  } finally {
    await close();
  }
}

// Phase F: the exact rate-limit Durable Object. Exported from the entry so the
// runtime can instantiate it; used via the optional RATE_LIMITER binding (the
// worker falls back to KV when it isn't configured).
export { RateLimiter } from "./durable/RateLimiter";

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledController,
    env: AppBindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(cleanupUnverifiedDomains(env));
    ctx.waitUntil(purgeDeletedAccounts(env));
    ctx.waitUntil(purgeExpiredHumanRecords(env));
    ctx.waitUntil(purgeOldClicks(env));
  },
};

/** Cron: TTL hygiene for the human check — challenge + token rows an hour past
 *  expiry carry no value (they can never verify or consume again). */
async function purgeExpiredHumanRecords(env: AppBindings): Promise<void> {
  const { db, schema, close } = getDbHandle(env);
  try {
    await purgeHumanRecords(db, schema);
  } finally {
    await close();
  }
}
