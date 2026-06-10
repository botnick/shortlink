# Architecture

How Shortlink is put together, and the reasoning behind the choices — especially the ones
that keep it running for **$0** on the Cloudflare free plan.

## The big picture

**One Cloudflare Worker serves everything**: the JSON API, the redirect hot path, the MCP
server for AI agents, and the React single-page-app shell. There is no separate backend, no
container, no always-on server. State lives in:

- **KV** — the global edge cache for redirects (read-mostly).
- **A SQL database** — Postgres (via Hyperdrive) *or* Cloudflare D1, your choice at deploy.
- **R2** — blob storage for QR logos and uploaded social-card images.
- **A Durable Object** — the exact, race-free rate limiter / abuse counter.

```
                         ┌───────────────────────── Cloudflare edge ─────────────────────────┐
   visitor / browser ──▶ │  Worker (worker/index.ts)                                          │
   crawler / API / MCP    │   ├─ /api/*      JSON API  (+ /api/v1/* = same routers, bearer keys)│
                          │   ├─ /mcp        MCP server (12 tools → dispatch back to /api/v1)   │
                          │   ├─ /:slug      redirect hot path                                  │
                          │   └─ /*          SPA shell (HTML with server-injected SEO)          │
                          │        │                                                            │
                          │   KV ◀─┼─▶ DB (Postgres/Hyperdrive | D1)   R2   Durable Object       │
                          └────────┴───────────────────────────────────────────────────────────┘
```

`wrangler.jsonc` runs the Worker first for every path **except hashed assets**
(`/assets/*`), which Cloudflare serves directly and for free.

## Request pipeline

Route registration order in `worker/index.ts` matters:

1. **A startup guard** asserts `SESSION_SECRET` is ≥ 32 bytes (once per isolate) — fail loud
   on a misconfig rather than serve with weak crypto.
2. **Security headers** on every response (HSTS, CSP `script-src 'self'`, frame-ancestors none, …).
3. **Public KV-cached endpoints** (`/api/config`, `/api/health`, `/api/qr/:slug`,
   `/api/unlock/:slug`) — registered before the API group so they skip its middleware.
4. **`/api/*` group:** `dbMiddleware → csrf → requireSameOrigin → loadSession → apiKeyAuth`.
   Requests with `Authorization: Bearer` **skip CSRF + same-origin** (those defend cookies;
   a bearer token is immune). `apiKeyAuth` resolves `sk_…` keys into the same `c.var.user` that
   sessions produce, so **`/api/v1/{links,domains,projects}` are the dashboard routers mounted a
   second time** — the public API can never drift from the UI.
5. **`POST /mcp`** — a hand-rolled stateless MCP server (Streamable HTTP JSON-RPC). Every tool
   dispatches back through `/api/v1/*` via `app.fetch`, inheriting all validation, auth, and
   limits. 12 tools; link refs accept an id, a slug, or a full short URL.
6. **`GET /:slug`** — the redirect (below).
7. **SPA fallback** with server-injected SEO/branding via HTMLRewriter.
8. **`app.onError`** preserves `HTTPException` statuses (a 403 stays a 403, not a masked 500)
   and renders a branded error page for non-API requests.

## The redirect hot path

This is the path that scales with traffic, so it's the most carefully tuned.

```
GET go.yoursite.com/promo
  │
  ├─ resolveScope(host)         which domain bucket? (default host vs a custom domain)
  │     └─ in-isolate memo → KV dhost:<host> → DB         (default host = 0 KV reads)
  ├─ KV  link:<domainId|_>:<slug>     ◀── ONE KV read on a warm cache (the hot read)
  │     └─ on miss: findLinkRow(DB) — live back-half, then retired alias — and warm the cache
  ├─ password gate?  → no-JS unlock page (CSP allows no inline scripts)
  ├─ safety interstitial?  → "you're leaving to …" page (admin-toggled)
  ├─ routeDestination(payload, os/device)   per-OS deep link from the cached payload
  └─ 302 + Cache-Control: private, no-store          ◀── deliberately NOT a cacheable 301
        └─ logClick via waitUntil (off the response path)   bot UAs flagged + excluded
```

Key decisions:

- **`302` + `no-store`, never a cacheable `301`.** This guarantees complete analytics and makes
  destination edits apply on the *very next* click — worth one origin hit per redirect.
- **The link lookup is a single KV read** on a warm cache. Everything else on the warm path is
  pure in-memory comparison. No crypto, no large JSON, well under the 10 ms CPU budget.
- **Clicks are logged in `waitUntil`**, after the response is sent — redirect latency never pays
  for analytics.
- **Graceful degradation:** if KV is over quota, the lookup falls back to the database; if the
  database is down too, the visitor gets a branded 404, never a 500.

## Per-domain back-halves

Slugs are unique **per domain** (a `coalesce(domain_id, sentinel), slug` unique index), so the
same back-half can exist on the default host and on each verified custom domain:
`go.brand-a.com/promo` and `go.brand-b.com/promo` are different links.

Editing a back-half is **Bitly-style**: the old `(domain, slug)` is retired to an **alias** that
keeps redirecting, so previously-shared links never break. The number of changes per link is
capped (admin setting) and shown as history in the editor.

## Database — dual-dialect

Drizzle ORM over **two interchangeable drivers**, chosen by the `DB_DRIVER` var:

- **Postgres** via Hyperdrive (`postgres.js`, a per-request client closed in `waitUntil`), or
- **Cloudflare D1** (SQLite).

The query layer is typed against the Postgres schema; the SQLite schema (`schema.sqlite.ts`)
mirrors it. A handful of spots branch on `c.var.dialect` for dialect-specific SQL (day buckets,
JSON containment for tag filters). **Both schema files and both migration sets are always kept in
lockstep** — a schema change touches `schema.ts` *and* `schema.sqlite.ts`, and generates both
migrations.

The `settings` table is a key/value store read through `getAllSettings`, so **adding an admin
setting needs no migration** — only the clicks/links/etc. structural tables do.

### Click history retention

The `clicks` table is the only one that grows with traffic. A daily cron purges rows older than
the admin-set **`clicksRetentionDays`** window (0 = keep forever). All-time per-link totals are
**not** lost — they live in the denormalized `links.click_count`; only the old per-click detail
(timeline, breakdowns) is trimmed. The delete is batched and uses a bounded `id IN (SELECT … LIMIT n)`
subquery so it works on both dialects and stays under D1's bound-parameter limit.

## Auth & account lifecycle

- **Sessions:** the 256-bit `sessions.id` primary key **is** the secret (only a separate
  `public_id` is ever exposed). PBKDF2 passwords, a device snapshot at sign-in, sliding renewal,
  a throttled `last_active_at`.
- **Passwords** are **peppered**: `PBKDF2(HMAC(SESSION_SECRET, password), salt, 20k)`. The pepper
  (`SESSION_SECRET`) lives only in the environment, so a database-only leak is uncrackable. 20k
  iterations is tuned to the Workers 10 ms CPU budget; legacy hashes are upgraded on next login.
- **Account closure is a soft delete:** links pause and caches purge instantly, sessions and API
  keys die, the email is tombstoned. A cron purges after the hold window, and the email stays
  unregistrable for an extra window (both admin-set). Account and API-key management are
  **session-only** on purpose — a stolen bearer key can't manage the account or escalate.

## Human check (self-hosted CAPTCHA)

Sign-in and sign-up are guarded by a self-hosted check — **no third party**. An invisible
browser **proof-of-work** plus, optionally, one of several randomized one-gesture mini-games
(slide / dial / hold / …). Challenges are HMAC-signed, IP-bound, single-use, and expiring; the
secret answer never leaves the server. Security is **economic** (CPU cost per attempt) and
layered (PoW + single-use tokens + interaction risk + game rotation), not based on client
secrecy. Modes (disabled / invisible / game) and difficulty are admin settings. Full threat model
in [human-check-v3.md](human-check-v3.md).

## Custom domains (Cloudflare for SaaS)

Members serve links from their own hostnames via **Cloudflare for SaaS custom hostnames** —
provisioned dynamically through the Cloudflare API at runtime, **not** by editing `wrangler.jsonc`.
Adding a domain calls `createCustomHostname`; the member adds a CNAME (to the fallback host) plus
the returned validation TXT records; Cloudflare issues a DV certificate and routes the hostname to
the Worker via the fallback origin. The Worker sees the original `Host` header, and `resolveScope`
maps it to the domain bucket. Without API credentials the app falls back to **DNS-TXT ownership
verification** (over DNS-over-HTTPS). See [DEPLOYMENT.md](DEPLOYMENT.md#letting-members-use-their-own-domains).

## The $0 design (what keeps it free)

Every per-request cost was engineered toward the Cloudflare free plan:

- **Rate limiting and abuse counters live in a Durable Object**, not KV — a login/API/abuse flood
  can't burn the 1k/day KV write budget. KV is a fallback only; if both the DO and KV are
  unavailable, a last-resort in-isolate counter still bounds a flood.
- **The redirect hot path makes zero KV writes on a cache hit** and one KV read; the cache is
  warmed lazily on a miss (in `waitUntil`), so never-clicked links cost nothing.
- **Public config and SEO are memoized in-isolate** (30 s), so warm isolates serve them with no KV
  read.
- **Click logging is the only DB write that scales with traffic**, and it's deferred off the
  response path; retention bounds the table.
- **Graceful degradation everywhere** — hitting a free-tier limit degrades (KV → DB → cached/
  defaults) instead of erroring.

The one hard ceiling no amount of engineering removes is **Workers' 100k requests/day** on the
free plan — see [DEPLOYMENT.md → Scale & cost](DEPLOYMENT.md#scale--cost--what-0-really-means).

## Frontend

React 19 + Vite + Tailwind v4, shadcn-style components, React Router. Pages live in `src/pages`
(admin tabs under `src/pages/admin`). A `ConfigProvider` fetches `/api/config` once and drives
branding (CSS variables), feature flags, and meta tags. Heavy pages are lazy-loaded. Every short
URL shown comes from the **server** (`link.shortUrl` / `config.appOrigin`), never built from
`window.location`, so dev hosts never leak into displayed links. `shared/types.ts` holds every DTO
shared by the Worker and the client.
