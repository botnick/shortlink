# Troubleshooting

Symptom → cause → fix. If your issue isn't here, check the Worker logs
(`npx wrangler tail`) — `app.onError` logs the real error server-side.

---

## Setup & secrets

### Every request 500s; login fails immediately
**Cause:** `SESSION_SECRET` is missing or shorter than 32 bytes. The app asserts the secret on
startup and refuses to serve with weak crypto.
**Fix:** set a strong value (`openssl rand -hex 32` → 64 chars) in `.dev.vars` *and* via
`wrangler secret put SESSION_SECRET`, then redeploy. The exact reason is in `wrangler tail`.

### `/setup` never appears, or "Setup has already been completed"
**Cause:** an admin already exists (the installer locks itself atomically after first use).
**Fix:** this is expected once you've created the admin. Log in instead. To start over you'd have
to clear the `users` table and the `setup_completed` row in `settings` (development only).

### "Invalid setup token" on `/setup`
**Cause:** the token you typed doesn't match `SETUP_TOKEN`.
**Fix:** make sure the same value is in `.dev.vars` (dev) or `wrangler secret put SETUP_TOKEN`
(prod). Re-deploy after changing a production secret.

---

## Domain & display

### Short links show `https://links.example.com/...`
**Cause:** `APP_URL` is still the placeholder.
**Fix:** set `vars.APP_URL` **and** `routes[].pattern` in `wrangler.jsonc` to your real domain
(same value), then redeploy. These two are the only place the domain is configured — there is no
"short domain" admin setting.

### My custom OG image / QR logo doesn't load
**Cause:** almost always `APP_URL` being wrong, since social cards and image URLs derive from it.
**Fix:** correct `APP_URL` (above). The image itself is stored in R2 and served from `/ogimg/:id`
relative to the current origin, so once `APP_URL` is right it resolves.

---

## HTTPS, headers & cookies

### Cookies don't stick / I get logged out / headers look weak
**Cause:** the Worker is seeing plain-HTTP requests. It picks strict headers (HSTS, CSP) and the
cookie `Secure` flag based on the request being HTTPS.
**Fix:** enable **Always Use HTTPS** in *Cloudflare → your domain → SSL/TLS → Edge Certificates*.
This is a required deploy step (see [DEPLOYMENT.md → Step 7](DEPLOYMENT.md#step-7--turn-on-always-use-https--dont-skip)).

---

## Custom domains (members)

### A member's domain won't verify
**Cause (DNS mode):** the `_shortlink-verify` TXT record isn't visible yet, or is wrong.
**Fix:** confirm the exact TXT name/value shown in the app, then wait — DNS can take minutes. The
Worker checks over public DNS-over-HTTPS, so it sees the record only once it has propagated.

**Cause (SaaS mode):** no Cloudflare API token / zone id configured, so adds fail at the API call.
**Fix:** in *admin → Settings → Custom domains*, set a token with *SSL and Certificates → Edit* and
the zone id. See [DEPLOYMENT.md](DEPLOYMENT.md#letting-members-use-their-own-domains).

### A verified domain resolves but shows no certificate / won't load
**Cause (DNS mode):** ownership is verified but the hostname isn't actually routed to the Worker.
**Fix:** connect it once as a free
[Workers Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
or use SaaS mode for fully-automatic TLS + routing.

### Unverified domains pile up
**Cause/Fix:** the daily cron removes domains left unverified past **Auto-remove unverified
domains** (admin setting, default 90 days). Set it to a smaller window, or 0 to disable.

---

## Database

### Every session-loading request 500s right after I changed the schema
**Cause:** the dev Worker hot-reloads and starts selecting new columns immediately, but the
migration hasn't run.
**Fix:** run `npm run db:migrate` (Postgres) **immediately** after editing a schema file. Always
edit **both** `schema.ts` and `schema.sqlite.ts` and generate both migrations.

### `DB_DRIVER=d1 but no D1 binding 'DB' is configured`
**Cause:** you set `DB_DRIVER: "d1"` but didn't uncomment the `d1_databases` block (or its
`database_id` is still the placeholder).
**Fix:** uncomment it and paste the id from `wrangler d1 create shortlink-db`.

### Postgres connection errors from the deployed Worker
**Cause:** TLS/firewall. The Worker reaches Postgres through Hyperdrive.
**Fix:** use `sslmode=require`, allow [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) on
the database, and double-check the Hyperdrive connection string. `sslmode=disable` is for local dev
only.

### The clicks table / database keeps growing
**Cause:** click history retention is off (default: keep forever).
**Fix:** set **Click history retention (days)** in *admin → Settings* (e.g. 90). A daily cron then
purges older raw rows; per-link totals are preserved regardless.

---

## Deploy & limits

### `npm run deploy` fails
**Cause:** not logged in, or a binding id is still a placeholder.
**Fix:** `npx wrangler login`, and make sure `REPLACE_WITH_KV_ID` / `REPLACE_WITH_HYPERDRIVE_ID`
are replaced with real ids in `wrangler.jsonc`.

### The site gets slow or some things stop caching under heavy traffic
**Cause:** you're hitting a Cloudflare free-plan limit (most likely **100k Worker requests/day** or
**100k KV reads/day**). The app degrades gracefully (cache → DB → defaults) rather than erroring,
but it's a signal you've outgrown the free plan.
**Fix:** see [DEPLOYMENT.md → Scale & cost](DEPLOYMENT.md#scale--cost--what-0-really-means). For
10k+ active users, move to the Workers Paid plan ($5/month). Set a click-retention window to keep
the database small.

### A link returns a branded 404 even though it exists
**Cause:** it's paused/expired, the cache is stale, or the request host maps to a different domain
bucket than the link was created on.
**Fix:** confirm the link is active and not expired; editing/saving it re-warms the cache. Check
that the visitor's host matches the link's domain (default host vs a custom domain).

---

## Local development

### `npm run dev` can't reach the database
**Cause:** the `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in `.dev.vars` is wrong
or unset (Postgres mode).
**Fix:** set it to a working `postgres://…` URL. For a local DB without TLS, use
`sslmode=disable`. On D1 you don't need it — dev simulates D1 automatically.

### I lost my dev data after running tests
**Cause:** `npm run test:e2e` truncates **all** rows — it must only ever point at a throwaway
database.
**Fix:** always pass a disposable `DBURL=…`; never run it against the database in your `.dev.vars`.
