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

/**
 * Symmetric encryption for admin-stored credentials (e.g. the Cloudflare API
 * token) so a DB-only leak can't expose them — the AES-GCM key derives from
 * SESSION_SECRET, which lives only in the Worker env, never in the database.
 * Mirrors the password pepper's threat model. Format: `enc1:` + base64(iv|ct).
 * Stored values without the prefix are treated as legacy plaintext (so existing
 * tokens keep working until the next admin save re-encrypts them).
 */
const ENC_PREFIX = "enc1:";

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(plaintext: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const buf = new Uint8Array(iv.length + ct.length);
  buf.set(iv, 0);
  buf.set(ct, iv.length);
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return ENC_PREFIX + btoa(bin);
}

export async function decryptSecret(stored: string, secret: string): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext — pass through
  try {
    const bin = atob(stored.slice(ENC_PREFIX.length));
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const key = await aesKey(secret);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf.slice(0, 12) },
      key,
      buf.slice(12),
    );
    return new TextDecoder().decode(pt);
  } catch {
    // Corrupt / wrong-key → treat as unset rather than leaking ciphertext as a token.
    return "";
  }
}
