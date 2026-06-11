# Deployment guide

A complete, copy-paste walkthrough to take Shortlink from zero to a live site on your
own domain. It runs on the **Cloudflare Workers free plan** — no monthly cost for a
normal-sized install.

> **The short version:** provision KV + R2 + a database, put your domain in **two**
> `wrangler.jsonc` fields, set **two** secrets, run the migration, `npm run deploy`,
> turn on *Always Use HTTPS*, then open your domain and create the admin. That's it.

If anything goes wrong, see **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**.

---

## Before you start

You need:

- **Node.js 22+** and **npm**
- A **Cloudflare account** with your domain added as a **zone** (free plan is fine)
- **`npx wrangler login`** — authorizes the CLI to create resources and deploy
- A **database** — either:
  - **Cloudflare D1** (recommended for simplicity — it's on Cloudflare, no external server, $0), or
  - **Postgres** reachable from Cloudflare (e.g. a managed provider or your own server, via Hyperdrive)

Pick the database now; the steps differ slightly and are labelled **[D1]** / **[Postgres]**.

---

## Step 1 — Install and configure local secrets

```bash
git clone <your-repo> shortlink && cd shortlink
npm install
cp .dev.vars.example .dev.vars
```

`.dev.vars` is the **one local config file** (gitignored). It's read by both `npm run dev`
and the migration tool. Open it and set:

```ini
# A long random string. The app REFUSES TO START if this is under 32 bytes.
SESSION_SECRET="<paste: openssl rand -hex 32>"

# Any random token — you'll type it once on the first-run /setup screen.
SETUP_TOKEN="<paste: openssl rand -hex 16>"

# [Postgres only] Local dev points Hyperdrive straight at your database.
# Use sslmode=disable only for a local DB; use require for a real one.
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://USER:PASS@HOST:5432/DB?sslmode=require"
```

> **Generate strong secrets.** `openssl rand -hex 32` gives a 64-char value (32 bytes) —
> well above the minimum. Never commit `.dev.vars` or paste real secrets into chat.

---

## Step 2 — Provision Cloudflare resources

Every install needs **KV** (the redirect cache) and **R2** (the QR-logo store):

```bash
# KV namespace — the redirect edge cache
npx wrangler kv namespace create LINKS_KV

# R2 bucket — QR logo library (bound by name; nothing to paste)
npx wrangler r2 bucket create shortlink-logos
```

Copy the **KV id** the first command prints into `wrangler.jsonc`, replacing
`REPLACE_WITH_KV_ID`. (Ids are not secrets — commit them.)

---

## Step 3 — Pick your database

### Option A — Cloudflare D1 (simplest, fully on Cloudflare) **[D1]**

```bash
npx wrangler d1 create shortlink-db          # prints a database_id
npx wrangler d1 migrations apply shortlink-db --remote
```

Then in `wrangler.jsonc`:
1. Set `"DB_DRIVER": "d1"`.
2. Uncomment the `d1_databases` block and paste the `database_id`.

That's it — no Hyperdrive, no external server. (You can leave the `hyperdrive` block; it's
ignored when `DB_DRIVER` is `d1`.)

### Option B — Postgres via Hyperdrive **[Postgres]**

Hyperdrive pools and accelerates connections to your Postgres from the edge:

```bash
npx wrangler hyperdrive create shortlink-db \
  --connection-string="postgres://USER:PASS@HOST:5432/DB?sslmode=require"
```

Paste the returned **Hyperdrive id** into `wrangler.jsonc`, replacing
`REPLACE_WITH_HYPERDRIVE_ID`. Keep `"DB_DRIVER": "postgres"`. Then create the schema:

```bash
npm run db:migrate     # reads .dev.vars, connects directly (not through Hyperdrive)
```

> **Postgres hardening:** restrict the database to [Cloudflare's IP ranges](https://www.cloudflare.com/ips/),
> use a least-privilege role (not a superuser), and keep `sslmode=require`. `sslmode=disable`
> is for local development only.

---

## Step 4 — Set your domain (the only domain config there is)

Short links live at `https://<your-domain>/<slug>`. The domain is set in **exactly two
places** in `wrangler.jsonc`, and they must be the **same value**:

```jsonc
"vars": {
  "APP_URL": "https://go.yoursite.com",   // ← your real domain
  "DB_DRIVER": "postgres"
},
...
"routes": [
  { "pattern": "go.yoursite.com", "custom_domain": true }   // ← same domain, no https://
]
```

- **`APP_URL`** is the canonical origin the Worker uses for every displayed short URL, QR
  target, and API doc. (There is **no** separate "short domain" admin setting — `APP_URL` is
  the single source of truth.)
- **`routes[].pattern`** with `custom_domain: true` tells Cloudflare to serve the Worker on
  that hostname and manage its DNS + TLS certificate automatically.

> The domain's **zone must be on your Cloudflare account**. Changing the served domain later
> means editing these two fields and redeploying — it can't be a runtime setting.

---

## Step 5 — Set the Worker secrets

Local `.dev.vars` doesn't ship. Set the two runtime secrets in Cloudflare once:

```bash
npx wrangler secret put SESSION_SECRET    # paste the SAME long value as in .dev.vars
npx wrangler secret put SETUP_TOKEN       # paste your setup token
```

> `SESSION_SECRET` signs cookies, peppers passwords, and keys the human check — it must be
> **≥ 32 bytes**; the app asserts this on startup and 500s loudly if it's weak or missing.

---

## Step 6 — Deploy

```bash
npm run deploy     # builds the client + Worker, then wrangler deploy
```

---

## Step 7 — Turn on "Always Use HTTPS" ⚠️ (don't skip)

In the **Cloudflare dashboard → your domain → SSL/TLS → Edge Certificates**, enable
**Always Use HTTPS**.

The Worker selects its strict security headers (HSTS, CSP) and the cookie `Secure` flag
based on the request being HTTPS. If a plain-HTTP request ever reaches it, those protections
weaken. *Always Use HTTPS* makes Cloudflare upgrade every request at the edge, so the Worker
only ever sees HTTPS. Treat this as a required deploy step.

---

## Step 8 — First-run setup (create the admin)

Open `https://go.yoursite.com`. Because no admin exists yet, you'll see the **`/setup`**
installer (it disappears after setup and can't be re-run — it locks itself atomically):

1. Enter your **`SETUP_TOKEN`**.
2. Pick an app name and brand color.
3. Create the admin email + password.

You're signed in as admin. Registration is **closed by default** — open it anytime from
**/admin → Settings**.

🎉 **Your shortener is live.** Everything below is optional tuning.

---

## Step 9 — Optional: configure in the admin console

All of these are live settings — **no redeploy**:

- **Branding & SEO** — logo, description, OG social card, X/Twitter handle, indexing toggle. The
  Worker auto-builds the page `<head>` (canonical, OG/Twitter cards, JSON-LD) and serves
  `/sitemap.xml` + `/robots.txt` from these.
- **Limits & safety** — blocked destination domains, reserved slugs, link/domain/key quotas,
  rate limits (login, link creation, API), random-slug length, human-check mode & difficulty.
- **Click history retention** — purge raw click rows older than N days to bound the database
  (0 = keep forever). Per-link totals are always preserved. See
  [CONFIGURATION.md → Admin settings](CONFIGURATION.md).
- **Analytics export row cap** — max rows one CSV export returns (default 10,000; 0 disables).
  Owners export a link's clicks; admins export across all links. See CONFIGURATION.md.
- **Custom domains for members** — see below.

### Letting members use their own domains

Members can serve links from `go.theirbrand.com`. Two modes, picked automatically:

**Automatic — [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-saas/) (recommended).**
In **/admin → Settings → Custom domains**, paste a **Cloudflare API token** (permission:
*SSL and Certificates → Edit*) and your **Zone ID**. Now a member just adds their domain on the
**Domains** page, points one **CNAME** at the fallback host, and it connects with automatic TLS —
no per-domain work for you, no redeploy. The first **100 custom hostnames are free**, then a
small per-hostname fee (check current Cloudflare for SaaS pricing).

**Manual / $0 — DNS verification.** Leave the token unset. A member adds their domain and a
`_shortlink-verify` **TXT** record; the Worker confirms ownership over public DNS-over-HTTPS.
To make a verified domain actually serve traffic, connect it once as a free
[Workers Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
Best when the domains are on your own Cloudflare account.

A cron (daily, 03:00 UTC) removes domains left unverified past the admin-set window
(**Auto-remove unverified domains**, default 90 days, 0 = never) and frees their Cloudflare
custom hostname.

---

## Scale & cost — what "$0" really means

| Cloudflare free-plan limit | What hits it | Headroom |
| --- | --- | --- |
| **Workers: 100,000 requests/day** | SPA loads, API calls, **every redirect** | The real ceiling — see below |
| KV: 100k reads/day, 1k writes/day | redirect cache | Reads track redirects; writes are tiny (well under) |
| D1 free: 500 MB/db, 100k writes/day | the clicks table | Use retention to stay under 500 MB |
| R2: 10 GB | QR logos / uploaded OG images | Plenty |
| Durable Object (rate limiter) | login/API/abuse throttling | On the free plan |

**The honest headline:** the **100k Worker-requests/day** cap is the first wall. That's roughly
a few thousand daily-active dashboard users, *or* ~100k redirects/day — whichever your traffic
leans toward. For genuinely large traffic (10k+ active users, viral links) you'll want the
**Workers Paid plan ($5/month**, which includes 10M requests/month and generous D1/Analytics
limits). No database choice changes this — it's a Workers limit.

**To get the most out of $0:** set a **Click history retention** window so the clicks table
(the only table that grows with traffic) stays bounded, and keep the human check enabled (it
throttles abuse at the edge via a Durable Object, never burning your KV budget).

---

## CI/CD (GitHub Actions)

The repo ships three workflows under `.github/workflows/`:

- **`ci.yml`** — typecheck + build on every PR/push.
- **`bump.yml`** — auto-increments the patch version on each push to `main`.
- **`deploy.yml`** — builds and deploys on push to `main`; skips cleanly until secrets exist.

Add repo secrets **`CLOUDFLARE_API_TOKEN`** (least-privilege: *Workers Scripts → Edit*) and
**`CLOUDFLARE_ACCOUNT_ID`**. Migrations are **not** run in CI (your DB firewall may block the
runner) — run `npm run db:migrate` yourself after a schema change.

---

## Updating after a schema change

When `worker/db/schema.ts` changes, generate **both** dialects' migrations and apply them:

```bash
npm run db:generate            # Postgres migration
npm run db:generate:sqlite     # D1/SQLite migration (always do both)

# then apply to whichever DB you run:
npm run db:migrate                                    # [Postgres]
npx wrangler d1 migrations apply shortlink-db --remote # [D1]
```

Then `npm run deploy`. See [ARCHITECTURE.md → Database](ARCHITECTURE.md#database--dual-dialect)
for why both schemas are kept in lockstep.
