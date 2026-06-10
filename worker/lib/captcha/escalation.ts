/**
 * Adaptive abuse pressure, shared by the human check and the auth endpoints.
 * Every failed check from an IP doubles the CPU its NEXT proof-of-work costs
 * (max +6 bits = 64×) and raises the initial risk tier of its next challenge.
 * Real users essentially never fail (the client only submits solved work), so
 * they never escalate — zero added friction; grinding bots price themselves
 * out exponentially. State lives in short-lived (1h) abuse counters keyed by a
 * hashed IP — never a permanent fingerprint.
 *
 * The counters go through the Durable Object (see counter* in ../ratelimit), NOT
 * raw KV: a bot flood of failures or honeypot pokes would otherwise burn the KV
 * daily write budget. They fall back to KV only when the DO binding is absent.
 */
import type { AppBindings } from "../../env";
import { hashIp } from "../geo";
import { counterBump, counterGet, counterMax } from "../ratelimit";
import { DECEPTION_KINDS, type DeceptionKind, type DeceptionReason } from "./decoys";

const ESCALATE_TTL = 3600;
const ESCALATE_MAX = 6;
const DECCOUNT_TTL = 7 * 86_400;

export async function escalationFor(
  env: AppBindings,
  ip: string | null,
): Promise<number> {
  if (!ip) return 0;
  return Math.min(ESCALATE_MAX, await counterGet(env, `powfail:${ip}`));
}

export async function recordCheckFailure(
  env: AppBindings,
  ip: string | null,
): Promise<void> {
  if (!ip) return;
  await counterBump(env, `powfail:${ip}`, ESCALATE_TTL);
}

/** A honeytoken hit isn't a near-miss — it's someone poking at fake bypass
 *  doors. Jump them straight to the maximum escalation (and hold it twice as
 *  long) so every subsequent challenge costs them the most CPU we allow. */
export async function recordHoneypotHit(
  env: AppBindings,
  ip: string | null,
): Promise<void> {
  if (!ip) return;
  await counterMax(env, `powfail:${ip}`, ESCALATE_MAX, ESCALATE_TTL * 2);
}

/** Structured deception logging + a rolling per-kind counter for the admin
 *  monitor. Logs the internal reason code (never a raw token/IP), and bumps a
 *  counter that the Security Deception Monitor reads. */
export async function recordDeception(
  env: AppBindings,
  kind: DeceptionKind,
  reason: DeceptionReason,
  ip?: string | null,
): Promise<void> {
  // Log a SALTED HASH of the IP, never the raw address (spec: no long-term raw
  // IP in logs). Retained Workers logs then carry only an opaque subject id.
  const subject = ip ? await hashIp(ip, env.SESSION_SECRET).catch(() => null) : null;
  console.warn(
    "humancheck deception:",
    reason,
    kind,
    subject ? subject.slice(0, 12) : "-",
  );
  await counterBump(env, `deccount:${kind}`, DECCOUNT_TTL);
}

export async function readDeceptionCounts(
  env: AppBindings,
): Promise<Record<DeceptionKind, number>> {
  const out = {} as Record<DeceptionKind, number>;
  await Promise.all(
    DECEPTION_KINDS.map(async (k) => {
      out[k] = await counterGet(env, `deccount:${k}`);
    }),
  );
  return out;
}
