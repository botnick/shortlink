/**
 * Token + binding crypto for the human check.
 *
 * Both the challenge reference and the verification token are OPAQUE 256-bit
 * random strings — not signed envelopes. There is nothing to decode or forge:
 * the server stores a SHA-256 of each and looks the record up by that hash, so
 * a database leak exposes no usable tokens, and a token's bindings (action,
 * hostname, session) live in the server record where the client can't touch
 * them. Base64/hex here is transport encoding, never a security mechanism.
 */
import type { AppBindings } from "../../env";
import { bytesToHex, randomHex } from "../encoding";

/** Challenge references look like `hc1_<64 hex>`, tokens like `hv1_<64 hex>`. */
export const CHALLENGE_REF_RE = /^hc1_[0-9a-f]{64}$/;
export const VERIFY_TOKEN_RE = /^hv1_[0-9a-f]{64}$/;

/** Mint an opaque secret with 256 bits of CSPRNG entropy. */
export function newOpaqueSecret(prefix: "hc1" | "hv1"): string {
  return `${prefix}_${randomHex(32)}`;
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Pre-auth "session" binding: an HMAC of the caller's IP under the server
 * secret. The raw IP is never stored (privacy), but a challenge solved from
 * one network can't be redeemed from another. Same binding strength the v2
 * proof-of-work used.
 */
export async function clientKeyFor(
  env: AppBindings,
  ip: string | null,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`hck1:${ip ?? "noip"}`),
  );
  return bytesToHex(new Uint8Array(sig)).slice(0, 32);
}

/** Count the leading zero bits of a byte array (proof-of-work measure). */
export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    let b = byte;
    while ((b & 0x80) === 0) {
      bits++;
      b <<= 1;
    }
    break;
  }
  return bits;
}

/**
 * The economic layer: SHA-256(ref + "." + solution) must carry `bits` leading
 * zeros. Public algorithm (Kerckhoffs) — what stops bots is CPU per attempt,
 * and the challenge ref is single-use so the work can't be amortized.
 */
export async function verifyPowSolution(
  ref: string,
  solution: unknown,
  bits: number,
): Promise<boolean> {
  if (bits <= 0) return true;
  if (typeof solution !== "string" || solution.length === 0 || solution.length > 64) {
    return false;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ref}.${solution}`),
  );
  return leadingZeroBits(new Uint8Array(digest)) >= bits;
}
