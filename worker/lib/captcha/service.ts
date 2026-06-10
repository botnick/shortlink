/**
 * Human check v3 orchestration — the only module that decides pass/fail.
 *
 * Lifecycle (Turnstile-style, but the game is mandatory whenever a game mode
 * is on):
 *
 *   POST /api/captcha/challenge  → opaque ref + first game (per server plan)
 *   POST /api/captcha/verify     → validate PoW + answer + evidence + risk
 *                                  → next game | retry | one-time opaque token
 *   login/register handler       → consumeHumanToken() — atomic, single-use,
 *                                  bound to action + hostname + client key
 *
 * Every rejection is generic on the wire ("Verification failed — please try
 * again"); the *reason* is logged server-side only, so an attacker can't probe
 * which layer caught them. Failures feed the PoW escalator, so each retry
 * costs more CPU than the last.
 */
import type {
  CaptchaAction,
  CaptchaChallengeDTO,
  CaptchaEvidence,
  CaptchaGameDTO,
  CaptchaVerifyResponseDTO,
  GameType,
} from "@shared/captcha";
import type { AppContext } from "../../env";
import {
  captchaConfigFrom,
  getCachedSettings,
  powDifficultyFrom,
  type CaptchaConfig,
} from "../settings";
import { rateLimited } from "./rateLimit";
import { getClientIp } from "../geo";
import {
  escalationFor,
  recordCheckFailure,
  recordHoneypotHit,
  recordDeception,
} from "./escalation";
import {
  generateDecoys,
  decoyToken,
  isDecoyToken,
  reasonKind,
  type DeceptionReason,
} from "./decoys";
import { isHoneyRef, issueHoneyRef, verifyHoneyRef } from "./honey";
import {
  VERIFY_TOKEN_RE,
  clientKeyFor,
  newOpaqueSecret,
  sha256Hex,
  verifyPowSolution,
} from "./crypto";
import { planChallenge } from "./plan";
import { GAME_PLUGINS, generateGame, type GameInstance } from "./games";
import { assessBehavior, hardFailure } from "./risk";
import { requestEnvFromContext, scoreRequest } from "./requestSignals";
import {
  claimChallengeStep,
  findChallengeByRefHash,
  insertChallenge,
  insertVerification,
  consumeVerification,
  type ChallengeRecord,
} from "./store";

/** Recursively round every number to 1 decimal. The client only needs enough
 *  precision to render; trimming it shrinks the payload and removes the
 *  false-precision floats that would otherwise fingerprint the generator. */
function roundDeep(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 10) / 10;
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = roundDeep(val);
    }
    return out;
  }
  return v;
}

function toGameDTO(g: GameInstance): CaptchaGameDTO {
  // Strips the secret state (and difficulty/issue clock) — the only shape the
  // client ever sees — and rounds the geometry it does send. The server keeps
  // the full-precision copy in the challenge row for validation; this is the
  // wire view only.
  return {
    id: g.id,
    type: g.type,
    prompt: g.prompt,
    payload: roundDeep(g.payload) as GameInstance["payload"],
  };
}

export type CreateChallengeResult =
  | { ok: true; dto: CaptchaChallengeDTO }
  | { ok: false; error: "rate-limited" | "disabled" };

export async function createChallenge(
  c: AppContext,
  action: CaptchaAction,
  accessible = false,
  /** Set when the challenge REQUEST itself tripped a trap — serve a Honey Game. */
  honeyReason: DeceptionReason | null = null,
): Promise<CreateChallengeResult> {
  const map = await getCachedSettings(c.var.db, c.var.schema);
  const cfg = captchaConfigFrom(map);
  if (cfg.mode === "disabled") return { ok: false, error: "disabled" };

  const ip = getClientIp(c);
  if (await rateLimited(c.env, `hc-create:${ip}`, cfg.createLimit, 60)) {
    return { ok: false, error: "rate-limited" };
  }

  // Honey Game: the challenge request tripped a trap (canary/tamper). Hand back a
  // real-LOOKING game whose ref is an HMAC-signed honey token — NO DB row ($0),
  // and whose verify path can never mint a real token. Fail-closed.
  if (honeyReason) {
    c.executionCtx.waitUntil(recordHoneypotHit(c.env, ip).catch(() => {}));
    c.executionCtx.waitUntil(
      recordDeception(c.env, reasonKind(honeyReason), honeyReason, ip ?? undefined).catch(() => {}),
    );
    const honeyGame = generateGame(cfg.games, "normal");
    const basePow = powDifficultyFrom(map);
    const honeyExp = new Date(Date.now() + cfg.challengeTtlSec * 1000);
    return {
      ok: true,
      dto: {
        ref: await issueHoneyRef(c.env, honeyReason),
        expiresAt: honeyExp.getTime(),
        pow: basePow > 0 ? { difficulty: basePow } : null,
        game: toGameDTO(honeyGame),
        gamesTotal: 1,
        gameIndex: 0,
        limits: { maxEvents: cfg.maxEvents },
        ...generateDecoys(),
      } as CaptchaChallengeDTO,
    };
  }

  // Abuse history raises the initial plan tier and the PoW price — it never
  // skips a game (risk tunes difficulty, not participation).
  const abuse = await escalationFor(c.env, ip);
  const plan = planChallenge(cfg.mode, cfg);
  const basePow = powDifficultyFrom(map);
  const powDifficulty = basePow > 0 ? Math.min(26, basePow + abuse) : 0;

  const ref = newOpaqueSecret("hc1");
  // Accessible path: ONE non-visual keyboard challenge (same PoW + single-use +
  // rate limits), even in invisible mode — a screen-reader user opts into this
  // instead of a silent/visual check. Otherwise: the normal plan.
  const game = accessible
    ? generateGame(["key-count"], plan.difficulty === "easy" ? "easy" : "normal")
    : plan.gamesTotal > 0
      ? generateGame(cfg.games, plan.difficulty)
      : null;
  // The accessible challenge is always exactly one game, even in invisible mode.
  const gamesTotal = accessible ? 1 : plan.gamesTotal;
  const expiresAt = new Date(Date.now() + cfg.challengeTtlSec * 1000);

  await insertChallenge(c.var.db, c.var.schema, {
    refHash: await sha256Hex(ref),
    action,
    hostname: c.req.header("host") ?? "",
    clientKey: await clientKeyFor(c.env, ip),
    mode: cfg.mode,
    gamesTotal,
    powDifficulty,
    game,
    playedTypes: game ? [game.type] : [],
    expiresAt,
  });

  return {
    ok: true,
    // Mix in realistic decoy fields (signature-ish hex, seeds, a policy bait…).
    // The server never reads them — they exist only to send a reverse-engineer
    // chasing meaning that isn't there. See decoys.ts.
    dto: {
      ref,
      expiresAt: expiresAt.getTime(),
      pow: powDifficulty > 0 ? { difficulty: powDifficulty } : null,
      game: game ? toGameDTO(game) : null,
      gamesTotal,
      gameIndex: 0,
      limits: { maxEvents: cfg.maxEvents },
      ...generateDecoys(),
    } as CaptchaChallengeDTO,
  };
}

/** Tar-pit (ms) applied to a honeytoken hit — wastes the attacker's time. Only
 *  ever reached by a request that contains a fake-bypass field a real client
 *  never sends, so no genuine user is ever delayed. */
const HONEYPOT_TARPIT_MS = 1200;

export interface VerifySubmission {
  ref: string;
  powSolution?: string;
  gameId?: string;
  answer?: unknown;
  evidence?: CaptchaEvidence;
}

export type VerifyOutcome =
  | { ok: true; body: CaptchaVerifyResponseDTO }
  | { ok: false; status: 403 | 429 };

export async function submitChallenge(
  c: AppContext,
  input: VerifySubmission,
  /** Set when the raw request tripped a canary / fake-bypass / decoy-token trap. */
  deception: DeceptionReason | null = null,
): Promise<VerifyOutcome> {
  const db = c.var.db;
  const schema = c.var.schema;
  const map = await getCachedSettings(db, schema);
  const cfg = captchaConfigFrom(map);
  const ip = getClientIp(c);

  if (await rateLimited(c.env, `hc-verify:${ip}`, cfg.verifyLimit, 60)) {
    return { ok: false, status: 429 };
  }

  // Honey Game ref: a decoy challenge from a tripped flow. Whether the signature
  // is valid (they're playing our honey) or forged (they're poking the honey
  // namespace), it can NEVER mint a real token. Log, escalate, tar-pit, decoy.
  if (isHoneyRef(input.ref)) {
    const honey = await verifyHoneyRef(c.env, input.ref);
    c.executionCtx.waitUntil(recordHoneypotHit(c.env, ip).catch(() => {}));
    c.executionCtx.waitUntil(
      recordDeception(c.env, "honeyGame", "HONEY_CHALLENGE_USED", ip ?? undefined).catch(() => {}),
    );
    await new Promise((r) => setTimeout(r, HONEYPOT_TARPIT_MS));
    // A valid honey solve gets the same fail-closed decoy token as any trap.
    void honey;
    return {
      ok: true,
      body: {
        status: "ok",
        token: decoyToken(),
        expiresAt: Date.now() + cfg.tokenTtlSec * 1000,
      },
    };
  }

  // Deception trap: the caller poked at a fake bypass door (a canary field, a
  // tampered decoy, a forged decoy token…). It's a trap, NOT a shortcut, and it
  // is fail-closed: hard-escalate them, log the internal reason, tar-pit, then
  // hand back a DECOY token (distinct `ag_decoy_` prefix) that can never verify,
  // so the "bypass" appears to work and then silently doesn't. A genuine client
  // never sends those fields, so there's no false positive.
  if (deception) {
    c.executionCtx.waitUntil(recordHoneypotHit(c.env, ip).catch(() => {}));
    c.executionCtx.waitUntil(
      recordDeception(c.env, reasonKind(deception), deception, ip ?? undefined).catch(() => {}),
    );
    await new Promise((r) => setTimeout(r, HONEYPOT_TARPIT_MS));
    return {
      ok: true,
      body: {
        status: "ok",
        token: decoyToken(), // ag_decoy_… ⇒ consume always rejects it
        expiresAt: Date.now() + cfg.tokenTtlSec * 1000,
      },
    };
  }

  // Generic on the wire; the why stays in server logs (sliced ids, no tokens,
  // no IPs — see the logging policy in docs/human-check-v3.md).
  const fail = async (
    escalate: boolean,
    code: string,
    cid?: string,
  ): Promise<VerifyOutcome> => {
    if (escalate) await recordCheckFailure(c.env, ip);
    console.warn("humancheck rejected:", code, cid ? cid.slice(0, 8) : "-");
    return { ok: false, status: 403 };
  };

  const row = await findChallengeByRefHash(db, schema, await sha256Hex(input.ref));
  if (!row) return fail(false, "unknown-ref");
  if (row.status !== "active") return fail(false, "not-active", row.id);
  if (row.expiresAt.getTime() < Date.now()) return fail(false, "expired", row.id);
  // Bindings: the network identity and hostname that minted the challenge must
  // be the ones redeeming it. No escalation — a flipped mobile IP is innocent.
  if (row.clientKey !== (await clientKeyFor(c.env, ip))) {
    return fail(false, "client-binding", row.id);
  }
  if (row.hostname !== (c.req.header("host") ?? "")) {
    return fail(false, "hostname-binding", row.id);
  }

  // Proof-of-work gate: solved once per challenge, on the first submit. A bad
  // solution locks the challenge — a genuine client never submits unsolved work.
  let powDone = row.powDone;
  if (!powDone && row.powDifficulty > 0) {
    if (!(await verifyPowSolution(input.ref, input.powSolution, row.powDifficulty))) {
      await claimChallengeStep(db, schema, row.id, row.version, { status: "locked" });
      return fail(true, "pow-failed", row.id);
    }
    powDone = true;
  }

  // --- Invisible mode: background confidence check --------------------------------
  if (row.gamesTotal === 0) {
    const abuse = await escalationFor(c.env, ip);
    // Escalate to ONE EASY game only when we're genuinely UNSURE: the IP has a
    // recent failure, OR the request-environment signals (datacenter ASN, header
    // incoherence, automation markers — all server-side, no interaction needed)
    // cross the medium-risk line. High confidence → token immediately.
    //
    // NOTE: a fast silent submit is NOT suspicious — the proof-of-work is solved
    // in tens of ms now, so the old "submitted < 400 ms → escalate" heuristic
    // fired on every legitimate user (and a bot can trivially wait anyway).
    const reqScore = scoreRequest(requestEnvFromContext(c)).score;
    if (abuse > 0 || reqScore >= cfg.riskMedium) {
      const game = generateGame(cfg.games, "easy");
      const won = await claimChallengeStep(db, schema, row.id, row.version, {
        gamesTotal: 1,
        game,
        playedTypes: [game.type],
        powDone,
      });
      if (!won) return fail(false, "step-conflict", row.id);
      return {
        ok: true,
        body: {
          status: "next",
          game: toGameDTO(game),
          gamesTotal: 1,
          gameIndex: 0,
          retriesLeft: cfg.maxRetries,
          expiresAt: row.expiresAt.getTime(),
        },
      };
    }
    return issueToken(c, cfg, row, powDone, 0);
  }

  // --- Game step -------------------------------------------------------------------
  const game = row.game;
  // The echoed gameId pins the submit to the CURRENT slot — replaying an
  // earlier step or racing ahead in the sequence dies here or on the version
  // guard below.
  if (!game || input.gameId !== game.id) return fail(false, "sequence", row.id);

  const evidence = input.evidence;
  if (!evidence) return fail(true, "no-evidence", row.id);
  if (evidence.events.length > cfg.maxEvents) {
    return fail(true, "event-flood", row.id);
  }
  const hard = hardFailure(evidence);
  if (hard) {
    await claimChallengeStep(db, schema, row.id, row.version, {
      status: "locked",
      powDone,
    });
    return fail(true, hard, row.id);
  }

  // Behavioral risk (how the pointer moved) + request signals (who connected,
  // from the free CF edge metadata + header coherence). Both are soft; combined
  // they decide retry/block against the admin thresholds.
  const behavior = assessBehavior(evidence, {
    issueToSubmitMs: Date.now() - game.issuedAtMs,
  });
  const reqSig = scoreRequest(requestEnvFromContext(c));
  const risk = {
    score: behavior.score + reqSig.score,
    reasons: [...behavior.reasons, ...reqSig.reasons],
  };
  if (risk.score >= cfg.riskMedium) {
    console.warn(
      "humancheck risk:",
      risk.score,
      risk.reasons.join(","),
      row.id.slice(0, 8),
    );
  }

  const valid = GAME_PLUGINS[game.type].validate({
    payload: game.payload,
    secret: game.secret,
    answer: input.answer,
    events: evidence.events,
    inputMode: evidence.inputMode,
    tolerance: cfg.toleranceMult,
  });
  // Shadow mode: when enforcement is off, a high risk score is logged but does
  // NOT block — the admin tunes thresholds on real traffic first. The game still
  // has to be solved correctly either way.
  const wouldBlock = risk.score >= cfg.riskHigh;
  const blocked = cfg.enforce && wouldBlock;
  if (wouldBlock && !cfg.enforce) {
    console.warn(
      "humancheck SHADOW would-block:",
      risk.score,
      risk.reasons.join(","),
      row.id.slice(0, 8),
    );
  }

  if (!valid || blocked) {
    const retries = row.retries + 1;
    if (retries >= cfg.maxRetries) {
      await claimChallengeStep(db, schema, row.id, row.version, {
        status: "locked",
        powDone,
        riskScore: row.riskScore + risk.score,
      });
      return fail(true, blocked ? "risk-high" : "out-of-retries", row.id);
    }
    // Retry = a FRESH layout, never the same board twice (and a different game
    // type when the pool allows) — screenshots and learned patterns go stale.
    // An accessible (key-count) challenge stays key-count on retry.
    const retryPool = game.type === "key-count" ? (["key-count"] as const) : cfg.games;
    const next = generateGame([...retryPool], game.difficulty, [game.type]);
    const won = await claimChallengeStep(db, schema, row.id, row.version, {
      retries,
      game: next,
      playedTypes: [...row.playedTypes, next.type],
      powDone,
      riskScore: row.riskScore + risk.score,
    });
    if (!won) return fail(false, "step-conflict", row.id);
    await recordCheckFailure(c.env, ip);
    return {
      ok: true,
      body: {
        status: "retry",
        game: toGameDTO(next),
        gamesTotal: row.gamesTotal,
        gameIndex: row.gameIndex,
        retriesLeft: cfg.maxRetries - retries,
        expiresAt: row.expiresAt.getTime(),
      },
    };
  }

  const nextIndex = row.gameIndex + 1;
  if (nextIndex < row.gamesTotal) {
    const next = generateGame(
      cfg.games,
      game.difficulty,
      row.playedTypes as GameType[],
    );
    const won = await claimChallengeStep(db, schema, row.id, row.version, {
      gameIndex: nextIndex,
      retries: 0,
      game: next,
      playedTypes: [...row.playedTypes, next.type],
      powDone,
      riskScore: row.riskScore + risk.score,
    });
    if (!won) return fail(false, "step-conflict", row.id);
    return {
      ok: true,
      body: {
        status: "next",
        game: toGameDTO(next),
        gamesTotal: row.gamesTotal,
        gameIndex: nextIndex,
        retriesLeft: cfg.maxRetries,
        expiresAt: row.expiresAt.getTime(),
      },
    };
  }

  return issueToken(c, cfg, row, powDone, risk.score);
}

/** Mark the challenge done (atomically — exactly one parallel submit can win
 *  the version race) and mint the one-time opaque verification token. */
async function issueToken(
  c: AppContext,
  cfg: CaptchaConfig,
  row: ChallengeRecord,
  powDone: boolean,
  addRisk: number,
): Promise<VerifyOutcome> {
  const db = c.var.db;
  const schema = c.var.schema;
  const won = await claimChallengeStep(db, schema, row.id, row.version, {
    status: "done",
    powDone,
    riskScore: row.riskScore + addRisk,
    game: null, // secret state is gone the moment it has served its purpose
  });
  if (!won) {
    console.warn("humancheck rejected:", "step-conflict", row.id.slice(0, 8));
    return { ok: false, status: 403 };
  }
  const token = newOpaqueSecret("hv1");
  const expiresAt = new Date(Date.now() + cfg.tokenTtlSec * 1000);
  await insertVerification(db, schema, {
    tokenHash: await sha256Hex(token),
    challengeId: row.id,
    action: row.action,
    hostname: row.hostname,
    clientKey: row.clientKey,
    expiresAt,
  });
  return {
    ok: true,
    body: { status: "ok", token, expiresAt: expiresAt.getTime() },
  };
}

/**
 * The protected-action side (the in-process equivalent of a /siteverify call):
 * redeem a verification token exactly once, checking every binding. Returns a
 * plain boolean — callers respond generically either way.
 */
export async function consumeHumanToken(
  c: AppContext,
  token: unknown,
  action: CaptchaAction,
): Promise<boolean> {
  // A forged decoy token (ag_decoy_/dev_/…) reaching a protected action is a
  // clear bypass attempt: log it, escalate, and reject. It never had a record,
  // so it could never have verified anyway — this just makes the trap visible.
  if (isDecoyToken(token)) {
    const ip = getClientIp(c);
    c.executionCtx.waitUntil(
      recordDeception(c.env, "decoyToken", "DECOY_TOKEN_USED", ip ?? undefined).catch(() => {}),
    );
    c.executionCtx.waitUntil(recordHoneypotHit(c.env, ip).catch(() => {}));
    return false;
  }
  if (typeof token !== "string" || !VERIFY_TOKEN_RE.test(token)) return false;
  // Consume FIRST (atomic), then check bindings: a token presented with the
  // wrong action/host/network is burned, never left around for a second try.
  const row = await consumeVerification(
    c.var.db,
    c.var.schema,
    await sha256Hex(token),
  );
  if (!row) return false;
  const ok =
    row.expiresAt.getTime() >= Date.now() &&
    row.action === action &&
    row.hostname === (c.req.header("host") ?? "") &&
    row.clientKey === (await clientKeyFor(c.env, getClientIp(c)));
  if (!ok) {
    console.warn("humancheck consume rejected:", action, row.challengeId.slice(0, 8));
  }
  return ok;
}
