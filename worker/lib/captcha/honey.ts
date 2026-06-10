/**
 * Honey Game — a STATELESS decoy challenge for broken/automated flows.
 *
 * When a challenge request itself trips a trap (a canary field, a tampered
 * payload), we hand back a real-LOOKING game whose ref is an HMAC-signed,
 * expiring token (`hcH_<body>.<sig>`) — NOT a row in `human_challenges`. So it
 * costs ZERO storage ($0, even under a flood) and can't be confused with a real
 * `hc1_` ref. The bot can "play" and "solve" it, but the verify path recognizes
 * the honey signature and is hard-wired to NEVER mint a real token — it just
 * measures automation and wastes the attacker's time. Fail-closed by design.
 */
import type { AppBindings } from "../../env";
import { bytesToHex, hexToBytes, randomHex, timingSafeEqual } from "../encoding";

const HONEY_TTL_MS = 2 * 60 * 1000;

const b64 = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))),
  dec: (s: string) => decodeURIComponent(escape(atob(s))),
};

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

export function isHoneyRef(ref: unknown): boolean {
  return typeof ref === "string" && ref.startsWith("hcH_");
}

/** Mint a signed, expiring honey ref carrying the reason it was issued. */
export async function issueHoneyRef(env: AppBindings, reason: string): Promise<string> {
  const body = b64.enc(JSON.stringify({ r: reason, exp: Date.now() + HONEY_TTL_MS, n: randomHex(8) }));
  const sig = await hmac(env, `honey:${body}`);
  return `hcH_${body}.${sig}`;
}

/** Verify a honey ref (signature + expiry). Returns its reason, or null. Never
 *  throws. A valid honey ref still NEVER yields a real verification token. */
export async function verifyHoneyRef(
  env: AppBindings,
  ref: unknown,
): Promise<{ reason: string } | null> {
  if (!isHoneyRef(ref)) return null;
  const [body, sig] = (ref as string).slice(4).split(".");
  if (!body || !sig || sig.length !== 64) return null;
  const expect = await hmac(env, `honey:${body}`);
  if (!timingSafeEqual(hexToBytes(sig), hexToBytes(expect))) return null;
  try {
    const p = JSON.parse(b64.dec(body)) as { r?: unknown; exp?: unknown };
    if (typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return { reason: typeof p.r === "string" ? p.r : "honey" };
  } catch {
    return null;
  }
}
