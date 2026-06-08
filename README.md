# Shortlink

A fast, clean, self-hosted **URL shortener** with accounts and detailed analytics.
Runs fully serverless on **Cloudflare Workers**; short links live on your own
domain, e.g. **`links.example.com/<slug>`**.

- **Stack:** Cloudflare Workers · [Hono](https://hono.dev) · React 19 + Vite + Tailwind v4 (shadcn-style UI)
- **Database:** your Postgres, reached via **Cloudflare Hyperdrive** (edge pooling + caching) with **Drizzle ORM** (`postgres.js`)
- **Auth:** email + password, server-side sessions, signed `__Host-` cookie
- **Analytics:** per-click time, country, referrer, device/browser/OS — IPs hashed, never stored raw
- **Speed:** redirects resolve from a global **KV** edge cache; clicks are logged off the response path (`waitUntil`)

## Features

- **Accounts** — email + password; registration is closed by default and toggled from `/admin`. Team management with multiple admins (the first/primary admin can't be removed by others).
- **Links** — random or custom slugs, optional title, expiry, and active/paused toggle; keyset-paginated dashboard.
- **Analytics** — per-link dashboard (Overview / Location / Sources / Share): total & unique clicks, a click-count table with rates, best day, a clicks-over-time chart, top countries (with flags), referrers, device/browser/OS, and a direct-vs-referrer split.
- **Branding & SEO — all from `/admin`, no redeploy** — app name, brand color (drives the whole accent), logo, description, social/OG image, and a search-engine indexing toggle. Injected into the page `<head>` server-side (HTMLRewriter) with a dynamic `robots.txt`, so social unfurls and crawlers see it.
- **QR code studio** (per link) — 11 frame styles with caption + scan icon + rounded/sharp corners; dot, eye-frame and eye-centre shapes & colors; solid or gradient fill; one-click **auto-match** color schemes; **extract a palette from an image**; a reusable **logo library** (stored in R2); per-user **saved presets**; export **PNG / SVG / JPEG** or copy to clipboard.

---

## Security

- **Secrets** live only in `.dev.vars` (gitignored) for local work, in Hyperdrive for the
  database credential, and in `wrangler secret` for the Worker runtime — never in the repo.
  If a credential is ever exposed, rotate it.
- **Database access** should be restricted to
  [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) and use a least-privilege role
  rather than a superuser.
- **TLS:** use `sslmode=require` so traffic between Cloudflare and Postgres is encrypted. If
  your database has no certificate, either enable TLS on it or front it with a
  [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/);
  `sslmode=disable` is intended only for local development.

The application itself enforces ownership checks on every link and stats route, server-side
admin checks, parameterized queries, scheme-validated redirect targets, CSRF protection,
hardened session cookies, strict security headers, and hashed visitor IPs.

---

## Prerequisites

- Node.js **22+**
- A Cloudflare account with **your domain's zone** added (for the custom-domain route)
- Your Postgres database (publicly reachable by Cloudflare)
- `npx wrangler login` (for provisioning + deploys)

## 1. Install

```bash
npm install
cp .dev.vars.example .dev.vars  # ONE local file: secrets + DB connection (used by dev AND migrations)
```

Generate strong random values (`openssl rand -hex 32`) for `SESSION_SECRET`,
`IP_HASH_SALT`, and `SETUP_TOKEN`.

## 2. Provision Cloudflare resources

```bash
# Hyperdrive in front of your Postgres
npx wrangler hyperdrive create shortlink-db \
  --connection-string="postgres://USER:PASSWORD@YOUR_DB_HOST:5432/YOUR_DB?sslmode=require"

# KV namespace for the redirect cache
npx wrangler kv namespace create LINKS_KV

# R2 bucket for the QR logo library (local dev simulates R2 automatically)
npx wrangler r2 bucket create shortlink-logos
```

Copy the returned **ids** into `wrangler.jsonc`, replacing `REPLACE_WITH_HYPERDRIVE_ID`
and `REPLACE_WITH_KV_ID`. (These ids are not secrets — commit them.) The R2 bucket is
bound by **name** (`shortlink-logos`), so there's no id to paste.

## 3. Database

```bash
npm run db:migrate   # apply schema (reads .dev.vars; connects directly, not via Hyperdrive)
```

## 4. Run & first-run setup

```bash
npm run dev          # Vite + Worker together, with HMR
```

Open the app — you’ll land on the **`/setup`** installer (it only appears until
setup is done). Enter your `SETUP_TOKEN`, set the app name / short domain, and create
the admin account. You’re then signed in as admin; open registration anytime from
**/admin**. No admin credentials are ever stored in files.

---

## Deploy

1. Make sure the real Hyperdrive/KV ids are committed in `wrangler.jsonc`.
2. Set the Worker runtime secrets once:
   ```bash
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put IP_HASH_SALT
   npx wrangler secret put SETUP_TOKEN
   ```
   Then open your deployed domain and complete the one-time installer.
3. Ship it:
   ```bash
   npm run deploy
   ```
   This builds the client + Worker and deploys to the custom domain you set in
   `wrangler.jsonc` (that domain's zone must be on Cloudflare).

### CI/CD (GitHub Actions)

- **`.github/workflows/ci.yml`** — typecheck + build on every PR/push.
- **`.github/workflows/bump.yml`** — auto-increments the patch version in `package.json`
  on each push to `main`, committing the change back as `chore: bump version … [skip ci]`.
- **`.github/workflows/deploy.yml`** — builds and deploys on push to `main`. It skips
  cleanly (no failure) until the Cloudflare secrets below are configured.

Add repo secrets: `CLOUDFLARE_API_TOKEN` (least-privilege: Workers Scripts edit) and
`CLOUDFLARE_ACCOUNT_ID`. Migrations are **not** run in CI (the DB firewall may block
runners) — run `npm run db:migrate` yourself when the schema changes.

---

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Local dev server (client + Worker, HMR) |
| `npm run build` | Build client → `dist/client`, Worker → `dist/shortlink` |
| `npm run deploy` | Build + deploy to Cloudflare |
| `npm run typecheck` | Type-check client, Worker, and Node configs |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `npm run db:generate` | Generate a new Drizzle migration from schema changes |
| `npm run db:migrate` | Apply migrations to Postgres |
| `npm run db:studio` | Open Drizzle Studio |
| `DBURL=… npm run test:e2e` | Integration test against a **throwaway** Postgres (creates then deletes data) |

## Testing

`tests/e2e.ts` drives the full API (setup → auth → links → redirect → click logging
→ stats → admin → IDOR) against a real Postgres via Hono's `app.fetch`, mocking only
the KV + ASSETS bindings, then truncates everything. Point it at a **disposable**
database:

```bash
DBURL="postgres://user:pass@host:5432/scratch?sslmode=disable" npm run test:e2e
```

## Project layout

```
worker/            Hono backend (API + redirect hot path + click logging)
  db/              Drizzle schema + client (Hyperdrive)
  lib/             auth, password (PBKDF2), sessions, slug, geo, cache, validators
  middleware/      session, security headers, CSRF, per-request DB
  routes/          auth, links, stats, admin
src/               React SPA (pages, shadcn-style UI, brand styling)
shared/            DTOs shared by Worker + client
tests/e2e.ts       Full-API integration test (real Postgres)
drizzle/           Generated SQL migrations
```

## How it works

- **Routing:** the Worker runs first for every path except hashed assets. `/api/*` is the
  JSON API, `/:slug` is the redirect, everything else serves the SPA shell.
- **Redirects:** `slug → destination` is read from KV (global edge cache). On a miss,
  Postgres is the source of truth and the cache is warmed. Clicks are recorded
  asynchronously so the redirect itself never waits on the database.
- **Security:** ownership checks on every link/stats route (404 on not-owned), admin role
  checks server-side, parameterized queries, scheme-validated destinations, CSRF + strict
  security headers, hardened session cookies, and hashed visitor IPs. The admin is
  created through a one-time, **token-gated** installer that atomically locks itself
  after first use (no "first user becomes admin" race); registration is closed by default.

> Passwords use PBKDF2-HMAC-SHA256 (600k iterations) via native Web Crypto — chosen over a
> JS scrypt/argon2 so hashing stays within the Workers CPU budget while remaining an
> OWASP-recommended KDF.
