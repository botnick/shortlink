# Custom domains

A complete, plain-English guide to serving Shortlink on a real domain — both the
**app's own domain** (e.g. `go.yoursite.com`) and **your members' domains**.

There are **two completely separate things** people mean by "custom domain". Read the
one-line test below and jump to the right section — mixing them up is the #1 source of
confusion.

| You want… | That's a… | Go to |
| --- | --- | --- |
| The whole app (dashboard + your links) to live on `go.yoursite.com` instead of `*.workers.dev` | **App domain** | [Part 1](#part-1--the-apps-own-domain) |
| Each member to run *their* links on *their own* `go.theirbrand.com` | **Member domain** | [Part 2](#part-2--member-domains) |

> **Where the domain's DNS must live — depends on the mode:**
> - **App domain (Part 1)** and **member domains in DNS-verification mode (Part 2B)**: the
>   domain's **zone must be on a Cloudflare account you control** (added to Cloudflare,
>   nameservers pointed at Cloudflare), because you route it as a Workers Custom Domain. Adding
>   a site to Cloudflare is free — *Add a site* in the dashboard, then update nameservers at
>   your registrar.
> - **Member domains via Cloudflare for SaaS (Part 2A)**: the **member's domain does NOT need to
>   be on Cloudflare** — they keep their existing DNS provider and just add one **CNAME** to your
>   fallback host. Only *your* app zone (the one the API token + Zone ID point at) is on
>   Cloudflare.

---

## Part 1 — the app's own domain

This points the entire app at one hostname you own. Example used throughout: **`go.yoursite.com`**.

Under the hood this uses a **[Workers Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)** —
Cloudflare connects your Worker to the hostname and **creates the DNS record and the TLS
certificate for you**. You do not touch DNS or manage certs by hand.

### 1.1 — Check the zone is on the right account

The Worker is deployed on one Cloudflare account; the domain's zone must be on the **same
account**. Confirm `yoursite.com` shows up in that account's site list. If the zone is on a
*different* account than the Worker, move the Worker or the zone so they match — a Workers
Custom Domain cannot cross accounts.

### 1.2 — Set it in `wrangler.jsonc` (two fields, one value)

Edit **two** fields and make their host **identical**:

```jsonc
{
  "vars": {
    "APP_URL": "https://go.yoursite.com",   // ← full URL, WITH https://
    "DB_DRIVER": "d1"
  },
  // The routes block ships commented out (default = *.workers.dev). Uncomment it:
  "routes": [
    { "pattern": "go.yoursite.com", "custom_domain": true }   // ← host only, NO https://
  ]
}
```

- **`APP_URL`** is the single source of truth for every *displayed* short URL, QR target,
  OG card and API doc. If this is wrong, links render with the wrong host even when routing
  works. (There is no separate "short domain" admin setting — this field is it.)
- **`routes[].pattern` + `custom_domain: true`** is what actually makes Cloudflare serve the
  Worker on that host and auto-manage its DNS + certificate.
- The two **must use the same host** (`go.yoursite.com`). `APP_URL` keeps the `https://`,
  the route does not.

### 1.3 — Deploy

```bash
npm run deploy
```

On deploy, Cloudflare provisions the custom hostname: it adds the DNS record and requests a
TLS certificate automatically. The first request may take a minute or two while the
certificate is issued — a brief "not secure" / SSL error right after deploy is normal; wait
and retry.

> **Deploying through Workers Builds (CI) instead of locally?** Same result — the built
> `wrangler.json` carries the `routes` block, so the custom domain is provisioned on the
> CI deploy. Just push to your production branch.

### 1.4 — Turn on "Always Use HTTPS" (required)

In **Cloudflare dashboard → `yoursite.com` → SSL/TLS → Edge Certificates**, enable
**Always Use HTTPS**. The Worker hardens its headers/cookies based on the request being
HTTPS; this makes Cloudflare upgrade every request at the edge. See
[DEPLOYMENT.md → Step 7](DEPLOYMENT.md#step-7--turn-on-always-use-https--dont-skip).

### 1.5 — Verify

```bash
curl -sI https://go.yoursite.com/api/health   # expect HTTP/2 200
```

Then open `https://go.yoursite.com` in a browser. Create a test link and confirm it shows
`go.yoursite.com/<slug>` (proof `APP_URL` is right) and that the slug redirects.

### Alternative: add it from the dashboard

You can also connect the domain without editing `wrangler.jsonc`:
**Workers & Pages → your Worker → Settings → Domains & Routes → Add → Custom Domain**
(the dashboard also has a dedicated **Domains** tab). If you do it this way, **still set
`APP_URL`** to that host (Variables, or `wrangler.jsonc`) and redeploy, or displayed links
keep the old origin. Keeping both in `wrangler.jsonc` is recommended so the config is the
source of truth and survives redeploys.

### Changing the app domain later

It's a deploy-time value, not a runtime setting: edit the same two fields and redeploy.
To go *back* to `*.workers.dev`, set `APP_URL` to the `…workers.dev` URL and comment the
`routes` block out again.

---

## Part 2 — member domains

Let each member serve their links from their own hostname (`go.theirbrand.com/<slug>`).
Slugs are unique **per domain**, so the same back-half can exist on the default host and on
every member domain. There are **two modes** — the app picks automatically based on whether
you've configured a Cloudflare API token.

### Mode A — Cloudflare for SaaS (automatic, recommended)

Cloudflare provisions a **custom hostname** + TLS for each member domain automatically. No
per-domain work for you, no redeploy.

**One-time setup (admin):** in **/admin → Settings → Custom domains**, fill in:

| Field | Value |
| --- | --- |
| **Cloudflare API token** | A token with **Zone › SSL and Certificates › Edit**. See **[CLOUDFLARE-API-TOKEN.md](CLOUDFLARE-API-TOKEN.md)**. |
| **Zone ID** | The zone the custom hostnames attach to (your app domain's zone). Find it on the domain's **Overview** page → API section. |
| **Fallback host** | What members point their CNAME at — defaults to the app's own host. |

**What a member does:** on the **Domains** page they add `go.theirbrand.com`, then create one
**CNAME** record (`go.theirbrand.com → <fallback host>`) at their DNS provider. Cloudflare
issues the certificate and starts serving — usually within minutes.

> **Cost:** Cloudflare for SaaS includes a free allotment of custom hostnames, then a
> per-hostname fee beyond it — the exact figures change, so treat
> [Cloudflare for SaaS pricing](https://developers.cloudflare.com/cloudflare-for-saas/) as the
> source of truth. The token is stored as an **admin setting**, not an env secret, so it can be
> rotated in-app with no redeploy.

### Mode B — DNS verification ($0, no token)

Leave the API token blank. Ownership is proven over public DNS; **you** route verified
domains.

**What a member does:** adds `go.theirbrand.com` on the **Domains** page and creates the shown
**`_shortlink-verify` TXT** record. The Worker confirms ownership over public
DNS-over-HTTPS (it only sees the record once it has propagated).

**What you must still do once per domain:** verification proves ownership but does **not**
route traffic. Connect each verified hostname once as a free
[Workers Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
(same mechanism as Part 1) so it actually reaches the Worker with TLS. This mode is best when
the member domains live on **your own** Cloudflare account.

### Housekeeping

A daily cron (03:00 UTC) removes domains left unverified past the admin window
(**Auto-remove unverified domains**, default 90 days, `0` = never) and frees their Cloudflare
custom hostname. Tune per-member quotas under **/admin → Settings → Limits** (*Domains per
member*).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Links display the old `*.workers.dev` (or placeholder) host | `APP_URL` not updated | Set `APP_URL` to your host and redeploy — it's the single source of truth |
| `https://go.yoursite.com` shows an SSL/"not secure" error right after deploy | Certificate still provisioning | Wait 1–2 min and retry; Cloudflare issues it automatically |
| Custom domain returns Cloudflare error 1016 / won't resolve | Zone not on the Worker's account, or route not deployed | Confirm the zone is on the **same account**; uncomment `routes` and redeploy |
| Cookies don't stick / headers look weak on the custom domain | Worker is seeing plain HTTP | Enable **Always Use HTTPS** (Part 1.4) |
| Member domain won't verify (DNS mode) | TXT not propagated / wrong value | Re-check the exact `_shortlink-verify` name+value in the app; wait for DNS |
| Member domain verifies but shows no cert / won't load (DNS mode) | Verified but not routed | Connect it once as a Workers Custom Domain, or switch to SaaS mode |
| Adding a member domain fails at the API call (SaaS mode) | Token/zone id missing or wrong permission | Set a token with **SSL and Certificates: Edit** + the right Zone ID — see [CLOUDFLARE-API-TOKEN.md](CLOUDFLARE-API-TOKEN.md) |

See also **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** and
**[DEPLOYMENT.md](DEPLOYMENT.md)**.
