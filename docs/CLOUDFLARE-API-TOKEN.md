# Cloudflare API tokens

A plain-English guide to creating the **API tokens** Shortlink can use, with the exact
least-privilege permissions for each job. An API token gives scoped, revocable access to
specific Cloudflare resources **without exposing your account password** — treat one like a
password, but one you can scope tightly and expire.

## Where tokens are used in this project

You only create the token(s) for the feature(s) you actually use. None are required for a
basic deploy.

| # | Job | Token permissions | Where it goes |
| --- | --- | --- | --- |
| 1 | **Member custom domains** via Cloudflare for SaaS (auto TLS) | **Zone › SSL and Certificates › Edit** | App UI → **/admin → Settings → Custom domains** (an admin setting, not an env secret) |
| 2a | **Deploy to already-provisioned resources** (GitHub Actions `deploy.yml`, steady state) | **Account › Workers Scripts › Edit** | GitHub repo → **Settings → Secrets and variables → Actions** → `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) |
| 2b | **First deploy / auto-provision + D1 migrate** (the very first push, or `npm run deploy`) | Add **Account › Workers KV Storage › Edit**, **Account › D1 › Edit**, **Account › Workers R2 Storage › Edit** to 2a | same as 2a (or the env var below) |
| 3 | **Local/automation wrangler** (optional, instead of `wrangler login`) | Same as 2a for redeploys; same as 2b to provision/migrate | Shell env var `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) |

> **You do NOT need a token to deploy via the Deploy button / Workers Builds.** Workers
> Builds runs inside Cloudflare with its own credentials. Tokens 2 and 3 are only for
> deploying *from outside* Cloudflare (GitHub Actions or your terminal).

---

## Step-by-step: create a custom token

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com).
2. Open **My Profile → [API Tokens](https://dash.cloudflare.com/profile/api-tokens)**.
3. Select **Create Token**, then scroll down and choose **Create Custom Token**.
   (Templates exist for common cases, but custom keeps it least-privilege.)
4. **Name** it after its job, e.g. `shortlink-saas-domains` or `shortlink-ci-deploy`.
5. **Permissions** — add exactly what the table above lists. Each row is
   *Category (Account / Zone / User) → Permission group → Access level*. Use **Edit** for
   read+write, **Read** for view-only. Add a row per permission needed.
6. **Account / Zone Resources** — scope it down:
   - Account-level permissions → pick the **specific account** (not "All accounts").
   - Zone-level permissions → pick the **specific zone** (not "All zones").
7. *(Optional, recommended)* **Client IP Address Filtering** to lock it to your CI/egress IP,
   and a **TTL** so it auto-expires.
8. **Continue to summary → Create Token.**
9. **Copy the token now** — it is shown **once**. Store it in your secret manager / paste it
   into the destination from the table above. If you lose it, roll a new one.

---

## Exact recipes

### 1. Member custom domains (Cloudflare for SaaS)

- **Permission:** `Zone` · **SSL and Certificates** · **Edit**
- **Zone Resources:** the zone your app domain lives on (the one custom hostnames attach to).
- Paste the token **and** that zone's **Zone ID** into **/admin → Settings → Custom domains**.
  Leaving the token blank keeps the free **DNS-verification** mode instead — see
  [CUSTOM-DOMAINS.md → Part 2](CUSTOM-DOMAINS.md#part-2--member-domains).

### 2. GitHub Actions deploy (`deploy.yml`)

- **Permission (steady state):** `Account` · **Workers Scripts** · **Edit** — enough to redeploy
  the Worker when KV/R2/D1 already exist.
- **Permission (first deploy / auto-provision):** also add `Account` · **Workers KV Storage** ·
  **Edit**, `Account` · **D1** · **Edit**, and `Account` · **Workers R2 Storage** · **Edit** — the
  very first deploy creates those resources by name, which the token must be allowed to do. (D1
  **Edit** is also what `npm run db:migrate:d1` needs to read the database and apply migrations.)
- **Account Resources:** the account the Worker is on.
- In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**,
  add `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (your account id).
  `deploy.yml` skips cleanly (stays green) until both exist, then deploys on every push to
  `main`. Note `deploy.yml` itself runs `wrangler deploy`, **not** migrations — apply the schema
  via `npm run deploy` (Workers Builds) or `npm run db:migrate:d1` from an allowed machine.

### 3. Local wrangler via token (instead of `wrangler login`)

```bash
export CLOUDFLARE_API_TOKEN="<your token>"
export CLOUDFLARE_ACCOUNT_ID="<your account id>"   # needed if you belong to >1 account
npm run deploy
```

Give it **Workers Scripts: Edit**; add **Workers KV Storage: Edit**, **D1: Edit** and
**Workers R2 Storage: Edit** only if you let this token auto-provision those resources.

---

## Finding your Account ID and Zone ID

- **Account ID** — on the account home / **Workers & Pages** overview, open the account menu and
  **Copy Account ID** (also shown on any zone's Overview page, API section).
- **Zone ID** — open the domain → **Overview** → scroll to the **API** section on the right →
  **Zone ID**.

Neither is a secret — they identify resources, they don't grant access. The **token** is the
secret.

---

## Account-owned vs user tokens

- **User token** (My Profile → API Tokens) is tied to *you*. Simplest; fine for personal use.
- **Account-owned token** (Manage Account → **Account API Tokens**, Superadmin only; secret
  prefixed `cfat_`) is tied to the *account*, so it keeps working if the creating user leaves —
  preferred for CI and shared services.

Both work anywhere this project expects a token.

---

## Security & rotation

- **Least privilege:** grant only the permission(s) in the recipe, scoped to the specific
  account/zone. Never use a Global API Key — it's all-powerful and can't be scoped.
- **Never commit a token.** Use GitHub Actions secrets, the admin setting, or an env var —
  not source, not chat. This repo's `.gitignore` already excludes `.dev.vars`/`.env`.
- **Rotate** by creating a replacement, swapping it in, then **deleting** the old token on the
  API Tokens page. The SaaS-domains token rotates with no redeploy (it's an admin setting).
- **Use TTL + IP filtering** for CI tokens so a leak has a short, narrow blast radius.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Authentication error (10000)` / 403 on deploy | Token lacks **Workers Scripts: Edit**, or wrong account scope | Recreate with the right permission scoped to the correct account |
| Adding a member domain fails (SaaS mode) | Token missing **SSL and Certificates: Edit**, or wrong Zone ID | Fix permission + zone id in **/admin → Settings → Custom domains** |
| `More than one account available…` (wrangler) | Multiple accounts, none selected | Set `CLOUDFLARE_ACCOUNT_ID`, or `account_id` in `wrangler.jsonc` |
| Token "works then stops" | TTL expired or it was rotated/revoked | Issue a fresh token and update the destination |

See **[CUSTOM-DOMAINS.md](CUSTOM-DOMAINS.md)** for where the SaaS token is used, and
**[DEPLOYMENT.md](DEPLOYMENT.md)** for the full deploy flow.
