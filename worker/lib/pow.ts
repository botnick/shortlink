/**
 * Self-hosted sign-up bot deterrence: a browser proof-of-work challenge.
 * No third-party service, nothing secret on the client — the algorithm is
 * public by design (Kerckhoffs). What stops bots is economics: every attempt
 * must burn real CPU finding a nonce whose SHA-256 has N leading zero bits.
 *
 * The challenge itself is HMAC-signed by the server (unforgeable), bound to
 * the caller's IP (not shareable), expires quickly (no precomputing a stash),
 * and is single-use via a KV marker (no replay).
 */
import type { AppBindings } from "../env";
import { bytesToHex, timingSafeEqual, hexToBytes, randomHex } from "./encoding";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface ChallengePayload {
  n: string; // random nonce
  ip: string; // caller IP (hashed into the signature only via inclusion here)
  exp: number; // epoch ms
  d: number; // required leading zero bits
}

async function hmac(env: AppBindings, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToHex(new Uint8Array(sig));
}

const b64 = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))),
  dec: (s: string) => decodeURIComponent(escape(atob(s))),
};

/** Issue a signed challenge for this caller. */
export async function issueChallenge(
  env: AppBindings,
  ip: string,
  difficulty: number,
): Promise<{ challenge: string; difficulty: number; expiresAt: number }> {
  const payload: ChallengePayload = {
    n: randomHex(16),
    ip,
    exp: Date.now() + CHALLENGE_TTL_MS,
    d: difficulty,
  };
  const body = b64.enc(JSON.stringify(payload));
  const sig = await hmac(env, body);
  return {
    challenge: `${body}.${sig}`,
    difficulty,
    expiresAt: payload.exp,
  };
}

/** Count the leading zero bits of a byte array. */
function leadingZeroBits(bytes: Uint8Array): number {
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
 * Verify a solved challenge: signature, expiry, IP binding, difficulty, and
 * single-use (a KV tombstone keyed by the signature). Returns false quietly on
 * any failure — callers respond with a generic error.
 */
export async function verifySolution(
  env: AppBindings,
  ip: string,
  difficulty: number,
  challenge: unknown,
  solution: unknown,
): Promise<boolean> {
  if (typeof challenge !== "string" || typeof solution !== "string") return false;
  if (solution.length > 64) return false;
  const [body, sig] = challenge.split(".");
  if (!body || !sig || sig.length !== 64) return false;

  // 1) Unforgeable: the server signed this exact payload.
  const expect = await hmac(env, body);
  if (!timingSafeEqual(hexToBytes(sig), hexToBytes(expect))) return false;

  let payload: ChallengePayload;
  try {
    payload = JSON.parse(b64.dec(body)) as ChallengePayload;
  } catch {
    return false;
  }
  // 2) Fresh, 3) bound to this caller, 4) issued at (at least) today's difficulty.
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
  if (payload.ip !== ip) return false;
  if (typeof payload.d !== "number" || payload.d < difficulty) return false;

  // 5) The actual work: SHA-256(challenge + solution) needs payload.d zero bits.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${challenge}.${solution}`),
  );
  if (leadingZeroBits(new Uint8Array(digest)) < payload.d) return false;

  // 6) Single-use: burn the signature. KV put is eventually consistent, which
  // is fine — replay within the propagation window is still rate-limited.
  const used = `pow:${sig}`;
  if ((await env.LINKS_KV.get(used)) !== null) return false;
  await env.LINKS_KV.put(used, "1", {
    expirationTtl: Math.max(60, Math.ceil((payload.exp - Date.now()) / 1000) + 60),
  });
  return true;
}
