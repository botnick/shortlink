/**
 * SESSION_SECRET underpins every server-side secret operation: password
 * peppering, signed-cookie HMAC, captcha crypto and client-IP hashing. A weak or
 * missing value silently degrades all of them at once, so we assert its strength.
 *
 * Workers have no startup hook (bindings only exist per-request), so this runs
 * as the first thing in the request pipeline and memoises its result — the check
 * happens once per isolate, then is a no-op for the isolate's lifetime. It only
 * ever fails on a deploy-time misconfiguration, in which case failing loudly is
 * the point: better a clear 500 than serving with broken cryptographic secrets.
 */
let verified = false;

/** Minimum acceptable secret length: 32 bytes = 256 bits of entropy. */
const MIN_SECRET_BYTES = 32;

export function assertSessionSecret(secret: string | undefined): void {
  if (verified) return;
  const bytes = secret ? new TextEncoder().encode(secret).length : 0;
  if (bytes < MIN_SECRET_BYTES) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SECRET_BYTES} bytes for secure ` +
        `cookie signing and password peppering (got ${bytes}). Generate one ` +
        "with `openssl rand -base64 48` and set it via " +
        "`wrangler secret put SESSION_SECRET`.",
    );
  }
  verified = true;
}
