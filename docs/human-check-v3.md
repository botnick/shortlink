# Human Check v3 — interactive game CAPTCHA

A self-hosted, server-authoritative human-verification layer for sign-in and
sign-up. Turnstile-style lifecycle (challenge → token → siteverify-on-consume).
The default mode is **invisible-first**: a silent proof-of-work + behavioral/
request scoring lets confident-human traffic pass without a game, escalating to
one short game only when the signals are unsure. In **game-only** mode everyone
plays at least one game (no silent pass). No third-party service; nothing on the
client is worth reverse-engineering.

---

## 1. Threat model

**Assets.** Account creation and login (the protected actions). The attacker's
goal is to pass the check at scale (mass fake sign-ups, credential stuffing).

**Attacker capabilities — assumed.** The attacker can:

- Read every byte the client receives (the challenge JSON, the React bundle).
- Modify any client code, hook the runtime, and replay/forge any HTTP request
  (Burp, mitmproxy, a Python `requests` loop).
- Drive a real browser headlessly (Playwright / Puppeteer / Selenium / raw CDP)
  and dispatch synthetic pointer/touch/key events.
- Compute the "answer" of a rendered game — for any client-rendered puzzle this
  is always possible and we do **not** assume otherwise.

**Explicitly NOT relied upon for security** (these are the things the prompt
calls out): client-side answer checking, Base64 "encoding as protection", JS
obfuscation/minification, disabling right-click, or any single environment
signal (headless / `navigator.webdriver` / Linux / WebView).

**What actually stops abuse — the layered moat:**

| Layer | Property | Defeats |
|---|---|---|
| Opaque tokens | challenge ref + verification token are 256-bit random; only their SHA-256 is stored | token theft from a DB leak; forging a token |
| HMAC bindings | challenge & token bound to action + hostname + caller (IP-HMAC) | using a token for another action/host/session |
| Single-use, atomic | `UPDATE … WHERE consumed_at IS NULL RETURNING` (one statement) | replay; parallel-submit double-spend |
| Short TTL | challenge ≤120 s, token ≤5 min, both admin-set | screenshot farms, precomputation |
| Proof-of-work | SHA-256 leading-zero-bits per challenge; failures escalate the cost ×2 each (capped) | mass automation economics — every attempt burns real CPU |
| Interaction proof | the answer must be supported by recorded pointer/key events (a drag must actually move) | "POST the computed answer" bots; teleport clicks |
| Risk engine | weighted behavioral signals (straight-line, equal-segment, constant-velocity, metronome cadence) | default Playwright/Puppeteer/CDP synthetic input |
| Per-challenge randomization | layout, rule, decoys, **and the shape geometry** regenerate every time; retries rotate the game type | static scripts; precomputed templates; learned single patterns |
| Rate limits | per-IP create/verify caps + per-IP auth throttle | grinding |

No single layer is claimed to be unbreakable. The design goal — the same one
Cloudflare Turnstile states — is to make passing **uneconomical at scale** and
to catch the naive automation that is the bulk of real abuse, while never
blocking a real person.

---

## 2. Data-flow & trust boundary

```mermaid
sequenceDiagram
    participant B as Browser (untrusted)
    participant W as Worker /api/captcha (trust boundary)
    participant DB as Postgres/D1 (challenge + token store)
    participant A as Auth handler (login/register)

    B->>W: POST /challenge {action}
    W->>W: plan (mode+risk), pick game, generate geometry + SECRET
    W->>DB: insert challenge (refHash, bindings, game incl. secret)
    W-->>B: {ref, pow?, game(public payload only), gamesTotal}
    Note over B: solve PoW in background; play the game;<br/>record compact interaction evidence
    B->>W: POST /verify {ref, powSolution, gameId, answer, evidence}
    W->>DB: load challenge by refHash
    W->>W: check bindings, PoW, hard-fails, risk, game.validate(secret)
    alt more games or retry
        W->>DB: atomic claimChallengeStep (version guard) → next game
        W-->>B: {status:next|retry, game}
    else done
        W->>DB: atomic claimChallengeStep → done; insert verification token
        W-->>B: {status:ok, token}
    end
    B->>A: POST /login|/register {humanToken, …}
    A->>DB: consumeVerification (atomic, single-use) + check bindings
    A-->>B: proceed only if the token redeemed for THIS action/host/caller
```

**Trust boundary = the Worker.** Everything the browser sends is suspect. The
*secret* game state (which object is correct, the target angle, the sort order)
is stored only in the challenge row and never serialized to a response.

---

## 3. "But the bot can read the JSON" — what we do about it

True, and unavoidable in general: to render a game the client must receive
geometry. Two things narrow the gap:

1. **No semantic answer in the payload.** The wire used to carry
   `"shape":"star"`; it no longer does. Each piece ships as a jittered **vertex
   polygon** with no name. To know which piece the prompt ("the star") refers
   to, a script must *visually classify* the outline — and the per-challenge
   radius/angle jitter means "this exact path == a star" can't be precomputed.
   (Honest caveat: classifying a *simple* polygon by counting vertices is cheap.
   This raises the bar from a string compare to perception; it is not a wall.)
2. **Knowing the answer is necessary but not sufficient.** Even with the answer,
   the submission must carry interaction evidence that supports it (a real drag
   that moves; a tap that lands), survive the risk engine, and ride a
   single-use challenge that cost a proof-of-work. That is where the cost lives.

The one game whose answer is structurally in the payload is **sort-by-size**
(the client must render the sizes). It's **off by default** for exactly this
reason; when enabled it relies entirely on the interaction + economic layers.

---

## 4. How this maps to Cloudflare Turnstile / reCAPTCHA

| Turnstile / reCAPTCHA technique | Here |
|---|---|
| Server-issued challenge, server-side verification (`/siteverify`) | ✅ `/api/captcha/*`; the auth handler "siteverifies" by atomically consuming the token |
| Opaque, single-use response token bound to a sitekey/action | ✅ 256-bit token, single-use, bound to action+hostname+caller |
| Token has a short expiry; reused/expired ⇒ `timeout-or-duplicate` | ✅ ≤5 min, replay ⇒ generic failure (reason logged server-side only) |
| Invisible / managed mode (most users never see a challenge) | ✅ `invisible` mode: silent PoW + risk, escalates to one easy game only when unsure |
| Behavioral / telemetry signals, not a single fingerprint | ✅ ephemeral interaction risk engine; no persistent fingerprint |
| Proof-of-work / client cost (Turnstile ships a PoW) | ✅ admin-set SHA-256 PoW with automatic per-IP escalation |
| Challenge rotation so one solver doesn't generalize | ✅ 6 game types, per-challenge geometry, retries rotate type |
| Accessibility path | ◑ fully keyboard-operable; an audio/alternate non-visual challenge is **not** implemented (see Limitations) |
| Privacy: no permanent device fingerprint | ✅ only ephemeral, per-site, short-TTL abuse counters (hashed IP), no font/canvas/audio fingerprint |

What Turnstile has that a self-hosted layer cannot: Cloudflare's network-scale
**reputation** (IP/ASN history across millions of sites) and private browser
attestation. We approximate the reputation piece with per-IP PoW escalation and
rate limits. That is the honest gap.

---

## 5. Security properties (verified by tests)

- Token sign/lookup, expiry, single-use, and action/hostname/session binding.
- Replay of a completed challenge or a consumed token ⇒ rejected.
- Parallel final submits ⇒ exactly one token (optimistic-concurrency version
  guard + atomic consume).
- Wrong answer, no-interaction, teleport drag, out-of-order or time-reversed
  events ⇒ rejected.
- Naive automation (straight line, equal steps, constant velocity, metronome
  cadence) ⇒ high risk; **no single soft signal** reaches the block threshold,
  so keyboard-only / `webdriver` / Linux / privacy-browser users are not
  blocked.
- Oversized payloads (event flood) ⇒ rejected (zod cap + admin per-challenge
  cap + 64 KB body limit).

Run them:

```bash
npx tsx tests/captcha.ts          # pure unit tests (no DB), runs anywhere
DBURL=postgres://… npm run test:e2e   # includes the DB-backed captcha flow
                                       #   (THROWAWAY DB — e2e wipes all rows)
```

---

## 6. Configuration (all admin settings — nothing hardcoded)

Admin → Settings → **Human check**. Mode (`disabled` / `invisible` /
`game-only` / `forced-game`), enabled game pool, PoW difficulty, touch
tolerance, challenge/token TTL, retries, max events, risk log/block thresholds,
games-per-challenge, and per-IP create/verify rate limits. Changing any of them
needs no migration (key/value `settings` table) and takes effect within ~8 s
(the hot-path settings memo TTL).

---

## 7. Cost model — staying inside a $0 serverless free tier

The whole design is built to scale to zero and keep the expensive work off the
server:

- **The only heavy compute is the proof-of-work, and it runs in the visitor's
  browser** (a Web Worker with a synchronous SHA-256 loop — `src/lib/sha256.ts`
  + `src/lib/pow.worker.ts`). The server merely verifies one hash. No server CPU
  scales with attacker effort.
- **No per-interaction API calls.** Pointer/key events are batched in the client
  and sent only on submit (`/verify`). The redirect hot path is untouched.
- **Static assets are CDN-cached**; the SPA shell + the tiny PoW worker add a
  few KB.

Per-signup backend cost (success path):

| Resource | Ops / signup | Cloudflare free tier | Headroom |
|---|---|---|---|
| Worker requests | ~3–4 (`/challenge`, `/verify`×N, auth) | 100k/day | ~25k signups/day |
| DB writes (challenge insert + step updates + token insert) | ~3–4 | D1: 100k writes/day | ~25k/day |
| KV writes (rate-limit counters) | ~2 | **KV: 1k writes/day** ⚠️ | ~500/day |

The binding free-tier limit is **KV writes (1k/day)**, consumed by the rate-limit
counters. To stay at $0:

- Keep the human-check `create`/`verify` rate limits **generous or 0** — the real
  throttle is the PoW economics + escalation + the existing per-IP *auth* throttle
  (one shared counter), not these. Each is an admin setting.
- Or run with `DB_DRIVER=d1` and move counters off KV (D1 gives 100k writes/day).
- Challenge/verification rows are purged by the existing daily cron once expired
  (TTL ≤120 s / ≤5 min), so storage stays flat.

Under a flood, the per-IP rate limits + PoW escalation cap the spend; KV/D1
writes are bounded by those limits, and the limiter fails **open** on a quota
blip (never locks real users out — abuse is still gated by PoW + single-use).

## 8. Defense layers added (Turnstile/reCAPTCHA parity, all $0)

Honest ceiling first: a self-hosted layer cannot match their **network-scale
reputation** (cross-site IP/ASN/bot-net history) or be Google/Cloudflare's ML.
Within that limit, these add the same signal *classes* they use — every signal
soft and capped below the block threshold, preserving "no single signal blocks":

- **A — Server request signals** ✅ `worker/lib/captcha/requestSignals.ts`. Free
  `request.cf` (ASN, HTTP protocol) + header coherence (Accept-Language /
  Sec-Fetch / Sec-CH-UA vs the UA). Catches `requests`/`curl` and UA-spoofers
  below the JS layer. Real Chrome/Firefox/Safari/VPN score 0.
- **B — Client env probe** ✅ `src/lib/captcha-probe.ts`. Ephemeral,
  non-fingerprinting: software-WebGL (SwiftShader), `window.chrome`/languages
  anomalies, dwell + did-the-user-interact-first. Catches lazy headless.
- **C — Session behavior** ✅ (folded into the probe) — page dwell + pre-game
  interaction, aggregates only.
- **F — Exact counters via Durable Objects** ✅ `worker/durable/RateLimiter.ts`
  (SQLite-backed, free plan; token bucket; self-cleaning alarm). Strongly
  consistent — no burst/parallel leak. Falls back to KV when unbound.
- **G — Observability + shadow mode** ✅ `captcha_enforce` setting +
  `/api/admin/captcha-stats` (reads live rows, zero writes) + admin panel.
  Score-but-don't-block to tune thresholds on real traffic before enforcing.
- **H — Accessible alternative** ✅ the `key-count` game
  (`worker/lib/captcha/games/keyCount.ts` + `KeyCountGame.tsx`): non-visual,
  keyboard-only, screen-reader friendly, server-validated (count + human
  timing) — not a bypass. Opt in via the "Keyboard-only" link.

**v3+ additions (all $0 — pure CPU / browser / stateless):**
- **Automation-driver markers** ✅ `captcha-probe.ts countAutomationMarkers` — counts
  chromedriver `cdc_`/`$cdc_`, Selenium, Playwright (`__playwright`/`__pw*`),
  Puppeteer, Nightmare, PhantomJS globals + webdriver attributes. Soft (+16),
  capped; a real browser reports 0. Catches the large majority of off-the-shelf
  Selenium/Playwright/Puppeteer that don't strip their markers.
- **Synthetic-event tell** ✅ the recorder records `event.isTrusted`; a stream of
  `isTrusted:false` pointer events is naive `dispatchEvent` automation (+18 soft).
  CDP-driven input is trusted, so this only catches the lazy ones — by design.
- **Client-side success canary** ✅ inert globals (`window.__captchaSolved`,
  `localStorage.captchaPassed`, `data-captcha-status`) that do nothing; if a script
  flips them, the probe reports `clientCanary` and the server treats it as a tamper
  trap (`CLIENT_CANARY_SET`).
- **Honey Game** ✅ `worker/lib/captcha/honey.ts` — a challenge request that trips a
  trap gets a real-LOOKING game whose ref is an **HMAC-signed, expiring honey token**
  (`hcH_…`, **no DB row → $0, flood-proof**); solving it via `/verify` can never mint
  a real token (fail-closed), only logs + escalates. Distinct namespace, impossible to
  confuse with a real `hc1_` ref.
- **All env signals capped at 45** so no single real-user quirk (Linux, VM software-WebGL,
  privacy browser, keyboard-only, VPN) can ever block — behavioral evidence must
  corroborate. Ship new signals with `captcha_enforce=false` (shadow) first.

**Anti-fixed-sprite (defeats "hash the rendered sprite once"):** pieces stay procedural —
the server jitters the polygon (±5% + free/k·90° rotation, heart flip) so the vertex list
differs every challenge, and the client rasterizes with a random cell-count (12–14) +
sub-cell offset per piece so the rendered bitmap differs every time too. Same clean,
readable silhouette; a different sprite each challenge. (Honest: a true vertex-count/CV
classifier can still read a star — that residual is covered by the economic + interaction
+ deception layers, not the shapes.) **The piece is NEVER rendered as a shape-named
asset** (e.g. a `/captcha-gems/star.webp` `<image>`): that would leak the answer in the
DOM as a plaintext URL, collapsing perception back to a string compare. The only raster
art is the **decorative full-scene backdrop** (`public/captcha-scenes/*.webp`), chosen by
*game type* (never the secret answer), purely cosmetic, painted over a procedural fallback
and skipped under `Save-Data` — it is no part of validation and leaks nothing.

**Deliberately NOT done (they cost money / break $0):**
- **D — Private Access Tokens** — needs an issuer (Apple/Cloudflare) or
  Turnstile (a 3rd party, which this project rejects). No clean self-hosted $0
  path.
- **E — Memory-hard PoW** — the server would have to run scrypt/Argon2 on every
  *verify*, burning Worker CPU (free tier caps it). SHA-256 keeps verify ~µs;
  the client still does the hard work, and failure escalation prices abuse.

### Performance

- The whole check (8 games + 11 themes + recorder + PoW worker) is **lazy-loaded**
  off the login/register critical path — a separate ~32 KB (10 KB gzip) chunk that
  streams in while the user reads the form (`Login.tsx`/`Register.tsx` `lazy()`).
- Each pixel sprite renders as **3 `<path>`s** (base/edge/top-bevel), not ~150
  `<rect>`s — far fewer DOM nodes on mobile.
- The decorative theme backdrop is **skipped under `Save-Data`** (flat fill instead).
- PoW runs in a Web Worker, started the instant the challenge arrives, overlapping play
  — the token is usually ready before the user submits.

## 9. Known limitations

- **Simple-shape CV.** Counting polygon vertices classifies the basic shapes
  cheaply. The geometry obfuscation raises the bar from field-read to
  perception; the real defense remains the interaction + economic layers.
- **Accessible alternative is keyboard-only, not audio.** The `key-count` game
  (the "Keyboard-only" opt-in) is non-visual + screen-reader friendly + server-
  validated, covering motor + keyboard + screen-reader users. A dedicated *audio*
  challenge for a different cohort is still possible future work.
- **PoW on very low-end devices.** Difficulty is admin-tunable; the default (16
  bits) solves in tens of ms in the Web Worker and runs in the background while
  the user plays, escalating only on failure. Extreme low-end hardware is slower.
- **No network reputation.** Unlike Turnstile we have no cross-site IP/ASN
  reputation; per-IP PoW escalation + rate limits are the substitute.
