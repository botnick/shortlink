# Shortlink

A fast, clean, self-hosted **URL shortener** with accounts, custom domains, QR codes
and detailed analytics — running entirely on **Cloudflare Workers** for **$0** on the
free plan. Short links live on your own domain: **`go.yoursite.com/<slug>`**.

```
Cloudflare Workers · Hono · React 19 + Vite + Tailwind v4 · Drizzle ORM · Postgres or D1
```

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/botnick/shortlink)

---

## What you get

- **Links** — random or custom back-halves, expiry, pause, tags + search, per-OS deep links
  (iOS / Android / desktop), password-protected links, a UTM builder, and bulk import (CSV, up to 500).
- **Per-domain back-halves** — slugs are unique *per domain*, so each member can run links on their
  own custom domain. Editing a back-half keeps the old one redirecting (Bitly-style retired aliases).
- **QR studio** — frames, shapes, colors, gradients, logo library, saved presets, PNG/SVG/JPEG.
- **Analytics** — totals, uniques, an adaptive time chart (hourly for 24h, daily otherwise), countries,
  referrers, device/browser/OS, live activity feed. Bot traffic is detected and excluded from every
  number. Export raw clicks as **CSV** (per link or, for admins, across everything) or the summary as JSON.
- **SEO, server-rendered** — canonical, Open Graph / Twitter cards, and WebSite/Organization JSON-LD
  injected into the page `<head>`, plus `/sitemap.xml` and `/robots.txt` — all driven by the admin
  branding settings, with a one-switch indexing toggle.
- **Accounts** — email + password, server-side sessions, active-session list, soft-delete account
  closure. A **self-hosted human check** (invisible proof-of-work + optional mini-games — no third party)
  guards sign-in / sign-up.
- **Public REST API + API keys** and an **MCP server** (12 tools) so AI agents can manage links.
- **Admin console** — branding/SEO, abuse limits, custom-domain setup, retention — **everything is
  configured in the app; nothing needs a redeploy.**

## Documentation

| Doc | What's inside |
| --- | --- |
| **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** | Step-by-step deploy to production — copy-paste friendly |
| **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** | Every setting: deploy-time (wrangler), secrets, and the admin knobs |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | How it works: request pipeline, redirect hot path, data model, the $0 design |
| **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** | Common errors and how to fix them |
| **[docs/human-check-v3.md](docs/human-check-v3.md)** | The human-check (CAPTCHA) threat model |

---

## Quick start (local, ~5 minutes)

You need **Node 22+** and a Postgres database (or use **D1** — no external DB; see below).

```bash
# 1. Install
npm install
cp .dev.vars.example .dev.vars

# 2. Fill in .dev.vars — generate secrets with:  openssl rand -hex 32
#    SESSION_SECRET   = a long random string (>= 32 bytes — the app refuses to start otherwise)
#    SETUP_TOKEN      = any random token (gates the first-run installer)
#    ...HYPERDRIVE_LOCAL_CONNECTION_STRING... = your Postgres URL

# 3. Create the database schema
npm run db:migrate

# 4. Run it (Vite + Worker together, hot-reload)
npm run dev
```

Open the app → you'll land on the **`/setup`** installer. Enter your `SETUP_TOKEN`,
create the admin account, and you're in. That's the whole local setup.

> **Prefer zero external services?** Use **Cloudflare D1** instead of Postgres — see
> [docs/DEPLOYMENT.md → Database](docs/DEPLOYMENT.md#step-3--pick-your-database). Local dev simulates
> D1, KV, and R2 automatically, so `npm run dev` just works.

### Going to production

The short version: provision **KV + R2 + (Hyperdrive or D1)**, set your **domain** in
`wrangler.jsonc` (two fields, same value), `wrangler secret put` your two secrets, then
`npm run deploy`. Full copy-paste walkthrough in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

---

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Local dev server (client + Worker, hot-reload) |
| `npm run build` | Build client → `dist/client`, Worker → `dist/shortlink` |
| `npm run deploy` | Build + deploy to Cloudflare |
| `npm run typecheck` | Type-check client, Worker, and Node configs |
| `npm run db:migrate` | Apply Postgres migrations (reads `.dev.vars`) |
| `npm run db:generate` / `:sqlite` | Generate a Drizzle migration after a schema change (do **both**) |
| `npm run db:studio` | Open Drizzle Studio |
| `DBURL=… npm run test:e2e` | Full-API integration test against a **throwaway** Postgres |

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md#dev-helper-scripts) for the dev seed helpers.

## Project layout

```
worker/            Hono backend — JSON API, redirect hot path, MCP server, click logging
  db/              Drizzle schemas (Postgres + D1 mirror) and the per-request client
  lib/             auth, password (peppered PBKDF2), slug rules, domain scoping, edge cache,
                   settings, rate limiting, human check, account lifecycle, social/SEO, retention
  middleware/      per-request DB, session + API-key auth, CSRF/origin, security headers
  routes/          auth, links, stats, projects, domains, qr-presets, assets, keys, account, admin
  mcp.ts           MCP server (stateless Streamable HTTP JSON-RPC)
src/               React SPA (pages, shadcn-style UI)
shared/            DTOs + brand-page renderers shared by Worker + client
drizzle/           Generated SQL migrations (drizzle/sqlite mirrors them for D1)
docs/              The guides linked above
```

## License

See the repository for license details.
