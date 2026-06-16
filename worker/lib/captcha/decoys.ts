/**
 * Deception layer — decoys, canaries, decoy tokens, and a honeytoken trap.
 *
 * PURPOSE: waste an attacker's time and catch the script-kiddie who thinks they
 * found a shortcut. This is NOT a security boundary — the real moat
 * (server-authoritative validation, single-use tokens, replay/session/action
 * binding, atomic consume, proof-of-work) stands entirely on its own. Every
 * trap here is FAIL-CLOSED: none of them can ever produce a valid verification
 * token, and a genuine client never trips one, so there are no false positives.
 *
 * Nothing here retaliates, hacks back, or attacks anyone. It only DETECTS,
 * raises risk, rate-limits, and logs — then answers with a generic/decoy
 * response that never reveals what was caught.
 */
import { pick, randFloat, randInt, sceneId } from "./rng";

function hex(chars: number): string {
  let s = "";
  while (s.length < chars) s += sceneId();
  return s.slice(0, chars);
}

// --- Internal reason codes (LOGGED only, never sent to the client) -----------
export type DeceptionReason =
  | "CANARY_FIELD_PRESENT"
  | "CLIENT_TRUST_OVERRIDE_ATTEMPT"
  | "FAKE_BYPASS_PARAMETER_USED"
  | "TAMPERED_PUBLIC_PAYLOAD"
  | "DECOY_TOKEN_USED"
  | "FAKE_BYPASS_ENDPOINT"
  | "DECOY_HEADER_PRESENT"
  | "HONEY_CHALLENGE_USED"
  | "CLIENT_CANARY_SET";

/** Counter bucket each reason rolls up into for the admin monitor. */
export const DECEPTION_KINDS = [
  "canary",
  "fakeEndpoint",
  "decoyToken",
  "clientOverride",
  "decoyHeader",
  "honeyGame",
] as const;
export type DeceptionKind = (typeof DECEPTION_KINDS)[number];

const REASON_KIND: Record<DeceptionReason, DeceptionKind> = {
  CANARY_FIELD_PRESENT: "canary",
  TAMPERED_PUBLIC_PAYLOAD: "canary",
  CLIENT_TRUST_OVERRIDE_ATTEMPT: "clientOverride",
  CLIENT_CANARY_SET: "clientOverride",
  FAKE_BYPASS_PARAMETER_USED: "canary",
  DECOY_TOKEN_USED: "decoyToken",
  FAKE_BYPASS_ENDPOINT: "fakeEndpoint",
  DECOY_HEADER_PRESENT: "decoyHeader",
  HONEY_CHALLENGE_USED: "honeyGame",
};
export const reasonKind = (r: DeceptionReason): DeceptionKind => REASON_KIND[r];

// --- Decoy payload fields ----------------------------------------------------

type DecoyGen = () => [string, unknown];

// Plausible, meaningless fields. A random subset ships with each challenge so
// the shape looks dynamic and load-bearing. The server NEVER reads any of them.
const DECOY_GENERATORS: DecoyGen[] = [
  () => ["renderMode", pick(["canvas", "svg", "hybrid"])],
  () => [
    "clientValidation",
    { enabled: true, level: randInt(1, 3), checksum: hex(16) },
  ],
  () => ["validationHint", `h_${hex(6)}`],
  () => ["answerFormat", pick(["v2", "v3", "compact"])],
  () => ["botScore", 0], // looks like a server score; echoing it back = tamper
  () => ["bypassEligible", false], // the bait — flipping to true is a tell
  () => ["v", randInt(2, 5)],
  () => ["sig", hex(40)],
  () => ["nonce", hex(16)],
  () => ["seed", randInt(100_000, 9_999_999)],
  () => ["entropy", Math.round(randFloat(0, 1) * 1e6) / 1e6],
  () => ["checksum", hex(8)],
  () => ["rev", `r${randInt(120, 999)}`],
  () => ["region", pick(["sea1", "eu-w", "us-e", "ap-s", "edge"])],
  () => ["shard", randInt(0, 31)],
  () => ["policy", { tier: randInt(1, 3), enforce: true, strict: pick([true, false]) }],
];

export function generateDecoys(): Record<string, unknown> {
  const order = DECOY_GENERATORS.map((_g, i) => [i, randInt(0, 1_000_000)] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([i]) => DECOY_GENERATORS[i]);
  const take = randInt(6, 10);
  const out: Record<string, unknown> = {};
  for (let i = 0; i < take; i++) {
    const [k, v] = order[i]();
    out[k] = v;
  }
  // Always include the two strongest baits so there's always a door to (not) open.
  if (!("bypassEligible" in out)) out.bypassEligible = false;
  if (!("policy" in out)) out.policy = { tier: 1, enforce: true, strict: true };
  return out;
}

// --- Canary / fake-bypass field detection ------------------------------------

// Flags that imply "the client decided it passed" — only a forger sends these.
const OVERRIDE_FIELDS = [
  "forceSuccess",
  "captchaPassed",
  "clientVerified",
  "validationOverride",
  "adminBypass",
  "riskOverride",
  "trustedClient",
  "internalScore",
  "botScore",
  "verified",
  "_verified",
];

// Switches a tinkerer flips hoping to skip the check.
const BYPASS_FIELDS = [
  "debugPass",
  "skipChallenge",
  "skip",
  "bypass",
  "skipPow",
  "skipVerify",
  "testPass",
  "qaMode",
  "devMode",
  "override",
  "unlock",
  "force",
  "debug",
];

/** Decoy verification-token prefixes. Distinct from the real `hv1_` so they can
 *  NEVER collide with a genuine token; presence is a forged-token signal. */
const DECOY_TOKEN_PREFIXES = [
  "ag_decoy_",
  "ag_debug_",
  "ag_client_verified_",
  "dev_",
];

export function isDecoyToken(token: unknown): boolean {
  return typeof token === "string" && DECOY_TOKEN_PREFIXES.some((p) => token.startsWith(p));
}

/** Mint a realistic-looking decoy token. Never recorded in storage, so
 *  siteverify/consume rejects it every time. */
export function decoyToken(): string {
  return `ag_decoy_${hex(24)}`;
}

/** A realistic-but-inert response for a fake bypass endpoint or a tripped trap.
 *  Looks like a queued verification to a script that trusts 200s; carries a
 *  decoy token that will never verify. */
export function decoyResponse(): Record<string, unknown> {
  return {
    success: true,
    status: "queued",
    verification: "pending",
    ttl: 300,
    token: decoyToken(),
    ...generateDecoys(),
  };
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true" || v === "yes";
}

/**
 * Inspect a raw verify request (body + headers + query) for any deception
 * trigger. Returns the internal reason code, or null if it looks clean. zod
 * strips unknown body keys, so this must run on the RAW body.
 */
export function detectDeception(input: {
  body: unknown;
  header: (name: string) => string | undefined;
  query: (name: string) => string | undefined;
  token?: unknown;
}): DeceptionReason | null {
  const { body, header, query, token } = input;

  // Forged verification token (decoy prefix).
  if (isDecoyToken(token)) return "DECOY_TOKEN_USED";

  // Decoy headers a real browser never sends.
  if (truthy(header("x-captcha-debug")) || truthy(header("x-captcha-bypass")) || truthy(header("x-internal-pass"))) {
    return "DECOY_HEADER_PRESENT";
  }

  // Decoy query params.
  if (truthy(query("bypass")) || truthy(query("debug")) || truthy(query("skip"))) {
    return "FAKE_BYPASS_PARAMETER_USED";
  }

  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    // Client claims it already passed / overrode trust.
    for (const f of OVERRIDE_FIELDS) {
      if (f in o && truthy(o[f])) return "CLIENT_TRUST_OVERRIDE_ATTEMPT";
    }
    // Bypass switches.
    for (const f of BYPASS_FIELDS) {
      if (f in o && truthy(o[f])) return "FAKE_BYPASS_PARAMETER_USED";
    }
    // Client-side success canary was tampered (reported by the probe).
    const ev = o.evidence;
    if (
      typeof ev === "object" && ev !== null &&
      typeof (ev as Record<string, unknown>).signals === "object" &&
      ((ev as { signals?: Record<string, unknown> }).signals?.clientCanary === true)
    ) {
      return "CLIENT_CANARY_SET";
    }
    // Flipping the decoy bait.
    if (truthy(o.bypassEligible)) return "TAMPERED_PUBLIC_PAYLOAD";
    const policy = o.policy;
    if (typeof policy === "object" && policy !== null && (policy as Record<string, unknown>).enforce === false) {
      return "TAMPERED_PUBLIC_PAYLOAD";
    }
    if (isDecoyToken(o.token) || isDecoyToken(o.humanToken)) return "DECOY_TOKEN_USED";
  }

  return null;
}
