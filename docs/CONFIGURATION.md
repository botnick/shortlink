# Configuration reference

Shortlink has **three** layers of configuration, from least to most flexible:

1. **Deploy-time** (`wrangler.jsonc` vars + bindings) — needs a redeploy to change.
2. **Secrets** (`.dev.vars` locally, `wrangler secret` in production) — sensitive values.
3. **Admin settings** (in the `/admin` console) — **live, no redeploy** — the vast majority of knobs.

> **Design rule:** nothing about behavior is hardcoded. Every limit, switch, and threshold is an
> admin setting. The two `wrangler.jsonc` values below are the *only* things you set outside the app.

---

## 1. Deploy-time vars (`wrangler.jsonc`)

| Field | Example | What it is |
| --- | --- | --- |
| `vars.APP_URL` | `https://go.yoursite.com` | **The** canonical origin — every displayed short URL, QR target, and API doc — **and** the single knob for your domain: the deploy derives the Worker's route from this host (`scripts/apply-domain.mjs`). Override **without editing this file** via an `APP_URL` **env var** (Workers Builds → Variables, or local `.dev.vars` / `export`); the value here is just the default. *(No separate "short domain" setting; single source of truth.)* |
| `vars.DB_DRIVER` | `postgres` or `d1` | Which database driver to use. |
| `routes` | *(auto-derived)* | You don't set this. `apply-domain.mjs` adds a `custom_domain` route from `APP_URL`'s host on deploy (none for a `*.workers.dev` host). See [CUSTOM-DOMAINS.md](CUSTOM-DOMAINS.md). |

Plus the resource **bindings**. KV, R2 and D1 **auto-provision by name** on your first
`npm run deploy` (no ids to paste — the "Created with" column is only if you'd rather make them by
hand). Ids are not secrets — if you do pin them, commit them.

| Binding | Auto-provisioned? | Created by hand with | Purpose |
| --- | --- | --- | --- |
| `LINKS_KV` | ✅ by name | `wrangler kv namespace create LINKS_KV` | Redirect edge cache |
| `LOGO_BUCKET` (R2 `shortlink-logos`) | ✅ by name | `wrangler r2 bucket create shortlink-logos` | QR logos + uploaded OG images |
| `DB` (D1 `shortlink-db`) | ✅ by name | `wrangler d1 create shortlink-db` | **[D1]** the database |
| `HYPERDRIVE` | — (opt-in) | `wrangler hyperdrive create …` + paste the id | **[Postgres]** pooled DB connection |
| `RATE_LIMITER` (Durable Object) | declared in `wrangler.jsonc` | — | Exact rate limiter. Optional — the Worker falls back to a KV limiter if absent. |
| `CLICK_AGG` (Durable Object) | declared in `wrangler.jsonc` | — | Aggregates clicks for the optional "rollup" logging mode (D1 only). Unused in the default "raw" mode. |
| `AI` (Workers AI) | declared in `wrangler.jsonc` | — | Powers the optional AI link assistant. No token; falls back to the offline optimizer if absent. |
| `ASSETS` | automatic | — | Serves the built SPA assets |

---

## 2. Secrets

Local development reads them from **`.dev.vars`** (gitignored). Production reads them from
**`wrangler secret`**. Never commit them.

| Secret | Required | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | **Yes** | Signs cookies, peppers passwords, keys the human check. **Must be ≥ 32 bytes** — the app asserts this on startup and refuses to serve if it's weak/missing. Generate with `openssl rand -hex 32`. |
| `SETUP_TOKEN` | **Yes** | Gates the one-time `/setup` installer. Generate with `openssl rand -hex 16`. |
| `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | Local **[Postgres]** only | Points local dev's Hyperdrive binding at your Postgres. Not needed in production (Hyperdrive holds the real credential) or on D1. |

Set production secrets with:

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SETUP_TOKEN
```

> Cloudflare-for-SaaS custom-domain credentials are **not** env secrets — they live in admin
> settings (so they can be rotated without a redeploy). See below.

---

## 3. Admin settings (`/admin → Settings`)

All live, no redeploy. Stored in the key/value `settings` table.

### Branding & SEO
App name, brand color, logo, description, social-card (OG) template / font / label / title /
tagline / accent, an optional **X / Twitter handle** (for the `twitter:site` card tag), and a
search-indexing toggle. From these the Worker auto-builds the SPA `<head>` (canonical, Open
Graph / Twitter cards, WebSite + Organization JSON-LD), serves `/sitemap.xml`, and references it
from `/robots.txt` — turning the indexing toggle off flips all of that to `noindex` + a
disallow-all robots file. Also the **brand-page copy** (404 / expired / password / interstitial
pages) — every string is editable, with shipped defaults — and an optional **link-safety
interstitial** ("you're leaving to …").

### Registration
Open or closed (closed by default).

### Limits & safety
| Setting | Default | Meaning |
| --- | --- | --- |
| Blocked destination domains | — | Links can't point at these (enforced on create, update, import, MCP). |
| Reserved slugs | — | Extra back-halves nobody can claim. |
| Links per member | 10,000,000 | Per-user link quota (0 = unlimited). |
| New links / hour / member | 60 | Link-creation rate limit. |
| Login attempts / 15 min / IP | 10 | Auth rate limit. |
| Domains per member | 10 | Custom-domain quota. |
| Back-half changes per link | 5 | Edit cap (0 = unlimited). |
| Random slug length | 6 | Length of auto-generated back-halves (3–32). |
| Closed-account hold (days) | 30 | How long a soft-deleted account is kept before purge. |
| Email re-signup block (days) | 180 | Extra window the email stays unregistrable after purge. |
| **Click history retention (days)** | **0 (forever)** | Purge raw click rows older than this to bound the DB. Per-link totals are always kept. |
| **Analytics export row cap** | **10,000** | Max rows one CSV export returns (0 = disable export). The default fits the Workers free 10 ms-CPU budget; raise it only on a paid plan. |

### Analytics & export
Per-link and admin-wide click analytics, bot-filtered, with adaptive time buckets (hourly for the
24h range, daily otherwise). Export raw clicks as CSV — per link (`/api/links/:id/clicks.csv`) or
across every link for admins (`/api/admin/export/clicks.csv`), both range-scoped and bounded by the
**Analytics export row cap** above. The stats page can also download its summary as JSON.

### Public API & MCP
On/off switches for the bearer-key API and the MCP server, plus the API rate limit and the
API-keys-per-member quota.

### Human check
Mode (disabled / invisible / game-only / forced-game), which mini-games are in the pool, min/max
games, proof-of-work difficulty, challenge + token TTLs, retry cap, risk thresholds, and the
per-IP challenge/verify limits. See [human-check-v3.md](human-check-v3.md).

### Custom domains (Cloudflare for SaaS)
| Setting | Meaning |
| --- | --- |
| Cloudflare API token | Permission *SSL and Certificates → Edit*. Enables automatic custom-hostname provisioning. Leave blank for $0 DNS-verification mode. See [CLOUDFLARE-API-TOKEN.md](CLOUDFLARE-API-TOKEN.md) + [CUSTOM-DOMAINS.md](CUSTOM-DOMAINS.md). |
| Zone ID | Your Cloudflare zone id. |
| Fallback host | What members CNAME to (defaults to the app's own host). |
| Max custom hostnames | Cost cap on Cloudflare-for-SaaS hostnames (free tier is 100, then per-hostname billing). Default **95**; 0 = unlimited. Adding a domain is blocked once this many exist. |
| Auto-remove unverified domains (days) | 90 (0 = never). A daily cron deletes domains left unverified this long and frees their Cloudflare custom hostname. |

### AI link assistant
| Setting | Meaning |
| --- | --- |
| AI assistant enabled | Master switch (default on). Powers the editor's "AI" button (slug + social-card suggestions from the destination page) on Workers AI. Per-user (10/hour) + global (100/day) caps and a 7-day per-URL cache keep it on the free tier; any failure falls back to the offline optimizer. Needs the `AI` binding. |

### Click logging
| Setting | Meaning |
| --- | --- |
| Click logging mode | **raw** (default) stores a row per click — exact, with unique visitors + a live feed. **rollup** aggregates hourly counts via the `CLICK_AGG` Durable Object so very high traffic stays under D1's write cap, at the cost of unique counts, the live feed and sub-hour detail. **D1 only.** Modes don't merge history — pick before heavy traffic. |

---

## Dev helper scripts

For local development against the database in your `.dev.vars`:

```bash
# Mint an API key for an account (prints it once)
npx tsx scripts/seed-api-key.ts <email> [name]

# Add a verified custom domain to an account
npx tsx scripts/seed-verified-domain.ts <email> <hostname>
```

> ⚠️ **Never run `npm run test:e2e` against your real/dev database** — it wipes all rows. Point it
> only at a throwaway database (`DBURL=… npm run test:e2e`).
