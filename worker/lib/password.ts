import { bytesToHex, hexToBytes, timingSafeEqual } from "./encoding";

/**
 * PBKDF2-HMAC-SHA256 via the native Web Crypto API (available in both the
 * Workers runtime and Node 20+). Native execution keeps us inside the Workers
 * CPU budget while staying an OWASP-recommended KDF. Kept dependency-free and
 * separate from session logic so the seed script can reuse it without pulling
 * in Worker-only bindings.
 */
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(new TextEncoder().encode(password)),
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

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(key)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  const actual = await deriveKey(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}
