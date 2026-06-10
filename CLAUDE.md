# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                  # Vite + Worker together (HMR); Worker code hot-reloads too
npm run typecheck            # tsc over client + worker + node configs — run before committing
npm run build                # client → dist/client, worker → dist/shortlink
npm run deploy               # build + wrangler deploy
npm run db:generate          # Drizzle migration from worker/db/schema.ts (Postgres)
npm run db:generate:sqlite   # the SAME change must also be generated for schema.sqlite.ts (D1)
npm run db:migrate           # apply Postgres migrations (reads .dev.vars directly, not Hyperdrive)
DBURL=… npm run test:e2e     # full-API integration test against a THROWAWAY Postgres

# Dev seed helpers (hit the real Postgres from .dev.vars):
npx tsx scripts/seed-verified-domain.ts <email> <hostname>   # verified custom domain
npx tsx scripts/seed-api-key.ts <email> [name]               # mint an API key, prints it once
```

There is no lint script. Verify backend behavior with `curl` against the dev server
(`http://localhost:5173/api/...`) — more reliable here than browser automation.

## Critical invariants

- **Migrate immediately after editing a schema file.** The dev Worker hot-reloads and starts
  selecting new columns at once; until `npm run db:migrate` runs, every session-loading request
  (including login) 500s.
- **Always change BOTH schema files** (`worker/db/schema.ts` + `worker/db/schema.sqlite.ts`) and
  generate BOTH migrations. The query layer is typed against the Postgres schema; SQLite mirrors
  it (`casing: "snake_case"` on both). drizzle-kit mangles `coalesce(...)` expressions inside
  SQLite index definitions — inspect the generated SQLite SQL and hand-fix those lines.
- **Bump `config:vN` in `worker/lib/appconfig.ts` whenever `AppConfigDTO` changes shape.** The
  public config is KV-cached; a stale cached shape silently reads new flags as off/undefined.
- **Nothing is hardcoded.** Every limit, switch and behavior knob is an admin setting (key/value
  `settings` table — no migration needed). Adding one touches: `SETTING_KEYS` + a `…From()` getter
  in `worker/lib/settings.ts`, `settingsSchema` in `worker/lib/validators.ts`, `SettingsDTO` in
  `shared/types.ts`, `toSettingsDTO` + the PATCH handler in `worker/routes/admin.ts`, and the
  AdminSettings UI. If it belongs in the public config, also `getPublicConfig` + `AppConfigDTO`
  + the `DEFAULT` in `src/lib/config.tsx` (and the cache bump above).
- **Auth errors stay generic by explicit requirement.** Login/registration/human-check failures
  must never reveal *why* (account closed, email blocked, bot check failed which layer…). Keep
  timing uniform (burn a hash on the failure path like the existing code does).
- **Display URLs come from the server.** Use `link.shortUrl` / `config.appOrigin` — never build
  display URLs from `window.location.origin` (leaks dev hosts). Server-side, the canonical origin
  is `shortOrigin(env)`, which derives from `APP_URL` (the single source of truth — there is no
  "Short domain" admin setting; `routes[].pattern` in wrangler must match `APP_URL`'s host).
- **Purge link caches BEFORE deleting rows.** `purgeLinkCache` reads `link_aliases`, which the
  delete cascades away. Use `refreshLinkCache`/`purgeLinkCache` (`worker/lib/linkCache.ts`) —
  never raw KV put/delete for links, since every link has multiple cache entry points.
- **New app routes must be reserved as slugs** in `worker/lib/slug.ts` (`RESERVED_LIST`).
- UI: in-app dialogs + toasts only — never `window.confirm/alert/prompt`. Icon-only buttons get a
  `Hint` wrapper (or native `title` when the element is a Radix `DropdownMenuTrigger asChild`).
  `Layout.tsx` already wraps pages in `max-w-5xl px-4 py-8` — don't double-wrap pages.
- Commit messages: plain English, no AI-credit lines.

## Architecture

One Cloudflare Worker serves everything: JSON API, redirect hot path, MCP server, and the React
SPA shell. `wrangler.jsonc` runs the Worker first for all paths except hashed assets.

### Request pipeline (worker/index.ts)

Route registration order matters:
1. Public KV-cached endpoints (`/api/config`, `/api/health`, `/api/qr/:slug`, `/api/unlock/:slug`)
   — registered before the API group so they skip its middleware entirely.
2. `/api/*` group: `dbMiddleware` → `csrf` → `requireSameOrigin` → `loadSession` → `apiKeyAuth`.
   Requests with `Authorization: Bearer` **skip csrf + same-origin** (cookie-attack defenses;
   bearer is immune — and Hono's csrf() would otherwise 403 bodyless DELETEs). `apiKeyAuth`
   resolves `sk_…` keys (sha256 lookup, KV-cached) into the same `c.var.user` sessions use, so
   `/api/v1/{links,domains,projects}` are the SAME routers mounted a second time — the public
   API can never drift from the dashboard.
3. `POST /mcp` — hand-rolled stateless MCP (Streamable HTTP JSON-RPC, no SDK to avoid a zod 3/4
   conflict). Tools dispatch back through `/api/v1/*` via `app.fetch`, inheriting validation,
   per-key rate limits and admin switches. 12 tools; link refs accept id | slug | full short URL.
4. `GET /:slug` — the redirect hot path (below).
5. SPA fallback with server-injected SEO/branding (HTMLRewriter).
6. `app.onError` preserves `HTTPException` statuses (don't mask 403s as 500s).

### Redirect hot path + per-domain back-halves

Slugs are unique **per domain** (`coalesce(domain_id, sentinel), slug` unique index), so the same
back-half can exist on the default host and on each verified custom domain:

`resolveScope(host)` (KV `dhost:<host>`) → KV `link:<domainId|_>:<slug>` → on miss,
`findLinkRow` checks live links then `link_aliases` (Bitly-style: editing a back-half retires the
old (domain, slug) to an alias that keeps redirecting; changes are capped per link, admin-set).
Response is always `302` + `Cache-Control: private, no-store` (deliberately NOT a cacheable 301 —
guarantees complete analytics and instant destination edits). Per-OS deep links resolve from the
cached payload (`routeDestination`). Clicks log via `waitUntil`, never on the response path;
bot traffic (`isBotUA`) is recorded with `is_bot` but excluded from every stat and the
denormalized `click_count`. Password-gated links render a no-JS unlock page (CSP allows no
inline scripts) that POSTs to `/api/unlock/:slug`.

### Database

Drizzle, dual-dialect: Postgres via Hyperdrive (`postgres.js`, per-request client closed in
`waitUntil`) or D1, chosen by the `DB_DRIVER` var. Dialect-specific SQL branches on
`c.var.dialect` (e.g. day buckets, json containment for tag filters). `settings` is a key/value
table read via `getAllSettings` — adding settings needs no migration.

### Auth & account lifecycle

- Sessions: PBKDF2 passwords, 256-bit token (the `sessions.id` PK **is** the secret — expose only
  `public_id`), device snapshot at sign-in, sliding renewal + throttled `last_active_at`.
- Human check v3 (`worker/lib/captcha/`, `worker/routes/captcha.ts`, mode = admin setting):
  Turnstile-style interactive game CAPTCHA. `POST /api/captcha/challenge` mints an opaque
  256-bit `ref` (only its SHA-256 is stored) + a server-chosen game whose SECRET answer never
  leaves the server; `POST /api/captcha/verify` checks proof-of-work + interaction evidence +
  per-game `validate()` + the risk engine, advancing an atomic challenge state machine
  (`humanChallenges`/`humanVerifications` rows, optimistic-concurrency `version` guard) until it
  issues a one-time verification token. Auth's `verifyHumanity()` "siteverifies" by atomically
  consuming that token (single-use, bound to action+hostname+IP-HMAC). Modes: disabled /
  invisible / game-only / forced-game. The game piece geometry is shipped as nameless jittered
  **polygons** (no `shape` field), so a script must visually classify, not read a field. Six
  games in `worker/lib/captcha/games/` (plugin interface; client renderers in
  `src/components/captcha/games/`). Security is the layered moat (PoW economics + single-use +
  interaction risk + game rotation + bindings), NOT client secrecy — see `docs/human-check-v3.md`
  for the threat model and the Turnstile/reCAPTCHA comparison. Tests: `npm run test:captcha`
  (unit, no DB) + `tests/captcha-flow.ts` (full chain vs a real DB).
- Account closure is a **soft delete** (`worker/lib/accountLifecycle.ts`, same path for
  self-service and admin removal): links paused + caches purged instantly, sessions/API keys
  killed, email tombstoned in `deleted_accounts`; cron purges after the hold window and the email
  stays unregistrable for an extra window (both admin-set). `/api/account/*` and `/api/keys/*`
  are session-only on purpose — a stolen bearer key must not manage keys or the account.

### Frontend

React 19 + Vite + Tailwind v4, shadcn-style components, React Router. Pages live in `src/pages`
(admin tabs under `src/pages/admin`). `ConfigProvider` fetches `/api/config` once and drives
branding (CSS vars), feature flags and meta tags. Heavy pages are lazy-loaded in `App.tsx`.
`shared/types.ts` holds every DTO shared by Worker and client.
