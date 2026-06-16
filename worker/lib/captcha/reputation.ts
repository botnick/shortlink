/**
 * Phase E — abuse reputation feeds the RISK engine, not only the PoW price.
 *
 * The escalation counters (escalation.ts) already make a grinding IP pay
 * exponentially more proof-of-work. This gives the BEHAVIORAL score the same
 * memory: an IP — and, weakly, an ASN — with recent failed checks starts each
 * verify already a little suspicious, so a repeat offender crosses the block
 * line sooner instead of getting a clean slate every attempt. It is the $0
 * approximation of the network-scale reputation Turnstile / reCAPTCHA have and
 * that this layer otherwise lacks (see docs/human-check-v3.md §9).
 *
 * Discipline unchanged from the rest of the engine:
 *  - SOFT and capped — neither signal can reach the block threshold alone.
 *  - A real user has ZERO recent failures, so they score ZERO here: identical
 *    to today. The counters only ever move on FAILED checks (bot traffic), so
 *    nothing is written on the legitimate pass path.
 *  - Per-IP is the strong signal; per-ASN is a weak nudge, capped low — a shared
 *    carrier / VPN ASN with one bot on it must never punish everyone behind it.
 *  - Privacy: this reads the SAME ephemeral `powfail:<ip>` counter the escalator
 *    already keeps — keyed by the raw connecting IP but short-TTL, internal to
 *    the rate-limit store, and never logged (logs use the HMAC `hashIp`). The
 *    ASN counter holds only a number. No new long-term per-user state.
 */
import type { AppBindings } from "../../env";
import { counterBump, counterGet } from "../ratelimit";

/** Rolling window for the cross-IP ASN abuse counter (bot pressure is bursty). */
const ASNFAIL_TTL = 6 * 3_600;

export interface ReputationSignal {
  score: number;
  reasons: string[];
}

/**
 * Pure scorer: turn recent per-IP and per-ASN failure counts into a soft,
 * capped risk add. Exposed for unit tests. The caps keep this well under the
 * block threshold so reputation always corroborates, never decides alone.
 */
export function reputationScore(ipFails: number, asnFails: number): ReputationSignal {
  const reasons: string[] = [];
  let score = 0;
  // Strong, per-IP: a specific address that keeps failing is the offender.
  if (ipFails > 0) {
    score += Math.min(24, ipFails * 6);
    reasons.push("ip-recent-fails");
  }
  // Weak, per-ASN: only after sustained abuse from a network, and capped at +8
  // so a noisy shared ASN can never block (or even escalate) a real user alone.
  if (asnFails >= 5) {
    score += Math.min(8, Math.floor(asnFails / 5) * 4);
    reasons.push("asn-recent-fails");
  }
  return { score, reasons };
}

/** Read the live per-IP + per-ASN abuse counters and score them. */
export async function reputationRisk(
  env: AppBindings,
  ip: string | null,
  asn: number | undefined,
): Promise<ReputationSignal> {
  const ipFails = ip ? await counterGet(env, `powfail:${ip}`) : 0;
  const asnFails = asn !== undefined ? await counterGet(env, `asnfail:${asn}`) : 0;
  return reputationScore(ipFails, asnFails);
}

/**
 * Record a failed check against the ASN-level counter. The per-IP `powfail`
 * counter is already bumped by `recordCheckFailure`; this is the cross-IP half.
 * Failures only — a real passing user never reaches it, so it adds no write to
 * the legitimate path.
 */
export async function recordAsnFailure(
  env: AppBindings,
  asn: number | undefined,
): Promise<void> {
  if (asn === undefined) return;
  await counterBump(env, `asnfail:${asn}`, ASNFAIL_TTL);
}
