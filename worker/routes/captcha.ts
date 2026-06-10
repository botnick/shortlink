/**
 * Public human-check endpoints (pre-auth by nature — they protect sign-in and
 * sign-up). They sit inside the /api group, so CSRF + same-origin checks apply
 * like every other browser endpoint. Request bodies are hard-capped, every
 * field is zod-validated, and all rejections are generic.
 *
 * This file also hosts the DECEPTION layer's fake-bypass endpoints — realistic
 * decoy routes that never issue a real token (see decoys.ts + the threat model
 * in docs/human-check-v3.md).
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../env";
import { captchaChallengeSchema, captchaVerifySchema } from "../lib/validators";
import { createChallenge, submitChallenge } from "../lib/captcha/service";
import { decoyResponse, detectDeception } from "../lib/captcha/decoys";
import { recordDeception, recordHoneypotHit } from "../lib/captcha/escalation";
import { rateLimited } from "../lib/captcha/rateLimit";
import { getClientIp } from "../lib/geo";

/** Evidence is bounded (≤1000 events × ~60 bytes), so 64KB is generous. */
const MAX_REQUEST_BYTES = 64_000;

const captcha = new Hono<AppEnv>();
captcha.use("*", bodyLimit({ maxSize: MAX_REQUEST_BYTES }));

captcha.post(
  "/challenge",
  zValidator("json", captchaChallengeSchema),
  async (c) => {
    const body = c.req.valid("json");
    // If the challenge REQUEST itself trips a trap (canary field / decoy header /
    // bypass query), serve a Honey Game instead of a real challenge.
    const raw = await c.req.json().catch(() => ({}));
    const honeyReason = detectDeception({
      body: raw,
      header: (n) => c.req.header(n),
      query: (n) => c.req.query(n),
    });
    const r = await createChallenge(c, body.action, body.accessible ?? false, honeyReason);
    if (!r.ok) {
      return r.error === "rate-limited"
        ? c.json({ error: "Too many attempts — please try again later" }, 429)
        : c.json({ error: "Verification is not enabled" }, 409);
    }
    return c.json(r.dto);
  },
);

captcha.post("/verify", zValidator("json", captchaVerifySchema), async (c) => {
  // Inspect the RAW request (zod strips unknown keys) for canary / fake-bypass
  // fields, decoy tokens, and decoy headers/query before doing real work.
  const raw = await c.req.json().catch(() => ({}));
  const deception = detectDeception({
    body: raw,
    header: (n) => c.req.header(n),
    query: (n) => c.req.query(n),
    token: (raw as { humanToken?: unknown }).humanToken,
  });
  const r = await submitChallenge(c, c.req.valid("json"), deception);
  if (!r.ok) {
    return r.status === 429
      ? c.json({ error: "Too many attempts — please try again later" }, 429)
      : c.json({ error: "Verification failed — please try again" }, 403);
  }
  return c.json(r.body);
});

// --- Fake bypass endpoints (DECEPTION) ---------------------------------------
// Realistic-looking "internal/debug" routes a tinkerer is tempted to call. They
// are FAIL-CLOSED: they never issue a real token and never touch the real
// verification store. They log the attempt, hard-escalate the caller, rate-limit
// them, and answer with an inert decoy that looks like a queued verification —
// wasting the time of any script that trusts a 200. The real backend only ever
// accepts tokens minted by /verify and redeemed via consume, so these can never
// become an actual bypass.
const FAKE_PATHS = [
  "/debug/verify",
  "/internal/pass",
  "/dev/solve",
  "/test/bypass",
  "/verify-v0",
  "/legacy-check",
  "/local-verify",
];
for (const path of FAKE_PATHS) {
  captcha.all(path, async (c) => {
    const ip = getClientIp(c);
    c.executionCtx.waitUntil(
      recordDeception(c.env, "fakeEndpoint", "FAKE_BYPASS_ENDPOINT", ip ?? undefined).catch(() => {}),
    );
    c.executionCtx.waitUntil(recordHoneypotHit(c.env, ip).catch(() => {}));
    // Cheap per-IP cap so the decoy can't be turned into free load.
    if (await rateLimited(c.env, `hc-fake:${ip}`, 30, 60)) {
      return c.json({ error: "Too many attempts — please try again later" }, 429);
    }
    return c.json(decoyResponse());
  });
}

export default captcha;
