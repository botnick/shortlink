import { bytesToHex, hexToBytes, timingSafeEqual } from "./encoding";

/**
 * Password hashing tuned for the Workers free-tier 10 ms CPU budget.
 *
 * A high PBKDF2 iteration count (OWASP's 600k) costs ~120 ms of CPU — it blows
 * the 10 ms per-request limit and the request is killed (Error 1102). So we
 * combine a MODEST iteration count with a server-side PEPPER: the password is
 * first HMAC-SHA256'd with a secret (`SESSION_SECRET`) that lives only in the
 * Worker env, never in the database. A database-only leak (the realistic breach:
 * SQL injection, leaked backup, stolen DB creds) is then unbruteforceable — the
 * attacker also needs the env secret — so the lower iteration count is safe AND
 * fits the CPU budget. The iterations only add cost in a FULL server compromise
 * (DB *and* SESSION_SECRET leak), which is already game-over for sessions.
 *
 * This is OWASP-endorsed (Password Storage Cheat Sheet: pepper + PBKDF2). Native
 * Web Crypto (Workers + Node 20+), dependency-free. Old unpeppered hashes
 * (`pbkdf2-sha256$…`) still verify for backward compatibility; `needsRehash`
 * lets callers transparently upgrade them on the next successful login.
 */
// Measured on the workerd runtime (wrangler dev): 20k≈5.5 ms, 30k≈8.3 ms,
// 50k≈13.8 ms, 600k≈120 ms. The login request also spends CPU on the human-check
// + session, so the default leaves margin under the 10 ms free-plan cap → 20k.
// The PEPPER, not the iteration count, is the real defense (see header), so a
// modest count is safe. The count is deploy-configurable via the
// `PBKDF2_ITERATIONS` var: keep ≤ ~45k on the free plan (10 ms CPU), raise toward
// OWASP's 600k only on the Workers Paid plan (30 s CPU). Changing it is seamless
// — each hash stores its own count, and `needsRehash` upgrades old hashes on the
// next successful login.
const DEFAULT_ITERATIONS = 20_000;
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 2_000_000;

/** Resolve the deploy-time PBKDF2 cost from the `PBKDF2_ITERATIONS` var, falling
 *  back to the safe default for anything missing or out of range. */
export function pbkdf2Iterations(env: { PBKDF2_ITERATIONS?: string }): number {
  const n = Number(env.PBKDF2_ITERATIONS);
  return Number.isInteger(n) && n >= MIN_ITERATIONS && n <= MAX_ITERATIONS
    ? n
    : DEFAULT_ITERATIONS;
}

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCHEME = "pbkdf2p1"; // peppered v1
const LEGACY_SCHEME = "pbkdf2-sha256"; // pre-pepper hashes (verify-only, back-compat)

const encoder = new TextEncoder();

/** HMAC-SHA256(secret, password) — binds the hash to the env secret (the pepper).
 *  One HMAC, so it adds no meaningful CPU. */
async function pepper(password: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(password));
  return new Uint8Array(sig);
}

async function deriveKey(
  material: Uint8Array,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(material),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  secret: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(await pepper(password, secret), salt, iterations);
  return `${SCHEME}$${iterations}$${bytesToHex(salt)}$${bytesToHex(key)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
  secret: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [scheme, iterStr, saltHex, expectedHex] = parts;
  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations < 1) return false;

  let material: Uint8Array;
  if (scheme === SCHEME) {
    material = await pepper(password, secret);
  } else if (scheme === LEGACY_SCHEME) {
    material = encoder.encode(password); // pre-pepper hash — verify as the old code did
  } else {
    return false;
  }
  const actual = await deriveKey(material, hexToBytes(saltHex), iterations);
  return timingSafeEqual(actual, hexToBytes(expectedHex));
}

/** True when `stored` isn't the current scheme/iterations — re-hash it (with the
 *  plaintext the user just supplied) on the next successful verify to upgrade. */
export function needsRehash(stored: string, iterations: number = DEFAULT_ITERATIONS): boolean {
  const parts = stored.split("$");
  return parts[0] !== SCHEME || Number(parts[1]) !== iterations;
}
