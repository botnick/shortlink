/**
 * Unit tests for the human-check (game CAPTCHA) security-critical core. No DB
 * and no network — these import the pure modules directly, so they run anywhere
 * with `npx tsx tests/captcha.ts`. The DB-backed integration properties
 * (atomic single-use consume, replay rejection, action/host/session binding,
 * parallel-submit race) are exercised in tests/e2e.ts against a throwaway DB.
 *
 * The "human evidence" synthesizer below doubles as a false-positive guard: it
 * produces curved, variable-speed, jittered input, and the risk engine must
 * PASS it. The automation synthesizers (teleport, linear-equal-steps,
 * constant-velocity) must be the ones that score high.
 */
import {
  CHALLENGE_REF_RE,
  VERIFY_TOKEN_RE,
  leadingZeroBits,
  newOpaqueSecret,
  sha256Hex,
  verifyPowSolution,
} from "../worker/lib/captcha/crypto";
import { assessBehavior, hardFailure, isCompleteProbe } from "../worker/lib/captcha/risk";
import { scoreRequest, type RequestEnv } from "../worker/lib/captcha/requestSignals";
import { scoreTransport, transportCohort } from "../worker/lib/captcha/transport";
import { reputationScore } from "../worker/lib/captcha/reputation";
import { takeToken } from "../worker/lib/captcha/tokenBucket";
import {
  detectDeception,
  generateDecoys,
  decoyToken,
  isDecoyToken,
  decoyResponse,
} from "../worker/lib/captcha/decoys";
import { isHoneyRef, issueHoneyRef, verifyHoneyRef } from "../worker/lib/captcha/honey";
import { GAME_PLUGINS, generateGame } from "../worker/lib/captcha/games";
import type {
  CaptchaEvent,
  CaptchaEvidence,
  CaptchaInputMode,
  GameType,
  ScenePoint,
} from "../shared/captcha";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

// --- deterministic-ish helpers (no Math.random reliance for assertions) ------

function dist(a: ScenePoint, b: ScenePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A curved, variable-speed, jittered drag A→B — what a real hand produces. */
function humanDrag(a: ScenePoint, b: ScenePoint, startMs = 200): CaptchaEvent[] {
  const events: CaptchaEvent[] = [{ t: "pointer-down", x: a.x, y: a.y, offsetMs: startMs }];
  const n = 22;
  // control point off the straight line → curvature
  const cx = (a.x + b.x) / 2 + 14;
  const cy = (a.y + b.y) / 2 - 10;
  let t = startMs;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    // ease-in-out → speed rises then falls (variable velocity)
    const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    const x = (1 - e) ** 2 * a.x + 2 * (1 - e) * e * cx + e * e * b.x + (Math.sin(i) * 0.6);
    const y = (1 - e) ** 2 * a.y + 2 * (1 - e) * e * cy + e * e * b.y + (Math.cos(i) * 0.6);
    t += 18 + (i % 3) * 9; // jittered cadence
    events.push({ t: "pointer-move", x, y, offsetMs: t });
  }
  events.push({ t: "pointer-up", x: b.x, y: b.y, offsetMs: t + 30 });
  return events;
}

/** A naive automation drag: straight line, equal steps, constant cadence. */
function botLinearDrag(a: ScenePoint, b: ScenePoint): CaptchaEvent[] {
  const events: CaptchaEvent[] = [{ t: "pointer-down", x: a.x, y: a.y, offsetMs: 100 }];
  const n = 20;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    events.push({
      t: "pointer-move",
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      offsetMs: 100 + i * 16, // metronome
    });
  }
  events.push({ t: "pointer-up", x: b.x, y: b.y, offsetMs: 100 + 21 * 16 });
  return events;
}

function tapEvent(p: ScenePoint, at: number): CaptchaEvent {
  return { t: "pointer-down", x: p.x, y: p.y, offsetMs: at };
}

function evidenceOf(
  events: CaptchaEvent[],
  inputMode: CaptchaInputMode = "mouse",
  signals?: CaptchaEvidence["signals"],
): CaptchaEvidence {
  const offs = events.map((e) => e.offsetMs);
  return {
    startedAtOffsetMs: Math.min(...offs, 0),
    completedAtOffsetMs: Math.max(...offs, 0),
    viewport: { w: 390, h: 780, dpr: 2 },
    inputMode,
    events,
    signals,
  };
}

const ENV = { SESSION_SECRET: "unit-test-secret-0123456789abcdef" } as never;

async function main() {
  // ---------------------------------------------------------------------------
  console.log("\n[1] Opaque tokens & PoW");
  {
    const ref = newOpaqueSecret("hc1");
    const tok = newOpaqueSecret("hv1");
    check("challenge ref matches format", CHALLENGE_REF_RE.test(ref), ref);
    check("verify token matches format", VERIFY_TOKEN_RE.test(tok), tok);
    check("256-bit entropy (64 hex)", ref.length === 68 && tok.length === 68);
    check("two mints differ", newOpaqueSecret("hc1") !== newOpaqueSecret("hc1"));

    const h1 = await sha256Hex("abc");
    check("sha256 stable + 64 hex", h1.length === 64 && h1 === (await sha256Hex("abc")));
    check("sha256 differs by input", h1 !== (await sha256Hex("abd")));

    check("leadingZeroBits(0x00ff)=8", leadingZeroBits(new Uint8Array([0x00, 0xff])) === 8);
    check("leadingZeroBits(0x80)=0", leadingZeroBits(new Uint8Array([0x80])) === 0);

    // PoW: find a real solution at low difficulty, prove it verifies and that
    // tampering / wrong difficulty fail.
    const powRef = "hc1_" + "a".repeat(64);
    const bits = 10;
    let sol = "";
    for (let i = 0; i < 200000; i++) {
      if (await verifyPowSolution(powRef, i.toString(36), bits)) {
        sol = i.toString(36);
        break;
      }
    }
    check("PoW solution found + verifies", sol !== "" && (await verifyPowSolution(powRef, sol, bits)));
    check("PoW wrong solution fails", !(await verifyPowSolution(powRef, sol + "x", bits)));
    check("PoW bits=0 always passes", await verifyPowSolution(powRef, "anything", 0));
    check("PoW oversized solution rejected", !(await verifyPowSolution(powRef, "x".repeat(65), bits)));
  }

  // ---------------------------------------------------------------------------
  console.log("\n[2] Risk engine — hard failures (protocol violations)");
  {
    const good = evidenceOf(humanDrag({ x: 20, y: 20 }, { x: 70, y: 70 }));
    check("clean evidence: no hard failure", hardFailure(good) === null);

    const reversed: CaptchaEvidence = { ...good, completedAtOffsetMs: good.startedAtOffsetMs - 5 };
    check("time reversed -> hard failure", hardFailure(reversed) === "time-reversed");

    const outOfOrder = evidenceOf([
      { t: "pointer-down", x: 1, y: 1, offsetMs: 100 },
      { t: "pointer-move", x: 2, y: 2, offsetMs: 40 },
    ]);
    check("out-of-order events -> hard failure", hardFailure(outOfOrder) === "events-out-of-order");
  }

  // ---------------------------------------------------------------------------
  console.log("\n[3] Risk engine — soft signals (no single signal blocks)");
  {
    const RISK_HIGH = 60;
    const human = assessBehavior(evidenceOf(humanDrag({ x: 18, y: 22 }, { x: 74, y: 66 })), {
      issueToSubmitMs: 2500,
    });
    check("human drag scores low", human.score < 30, human);

    const bot = assessBehavior(evidenceOf(botLinearDrag({ x: 18, y: 22 }, { x: 78, y: 70 })), {
      issueToSubmitMs: 2500,
    });
    check("naive linear bot scores high (>= block)", bot.score >= RISK_HIGH, bot);
    check(
      "bot flagged for line/segments/velocity",
      bot.reasons.some((r) => ["ruler-line", "equal-segments", "constant-velocity", "uniform-cadence"].includes(r)),
      bot.reasons,
    );

    const empty = assessBehavior(evidenceOf([]), { issueToSubmitMs: 2500 });
    check("no interaction scores high", empty.score >= 40, empty);

    const instant = assessBehavior(evidenceOf(humanDrag({ x: 10, y: 10 }, { x: 60, y: 60 })), {
      issueToSubmitMs: 100,
    });
    check("instant submit adds risk", instant.score > human.score, instant);

    // Each soft signal alone stays under the block threshold (no false positives
    // for Linux / privacy browser / webdriver-spoof / keyboard-only).
    const wd = assessBehavior(
      evidenceOf(humanDrag({ x: 18, y: 22 }, { x: 74, y: 66 }), "mouse", { webdriver: true }),
      { issueToSubmitMs: 2500 },
    );
    check("webdriver hint alone does NOT block", wd.score < RISK_HIGH, wd);

    const kb = assessBehavior(
      evidenceOf(
        [
          { t: "key-down", targetId: "a", offsetMs: 400 },
          { t: "key-down", targetId: "a", offsetMs: 800 },
          { t: "key-down", targetId: "a", offsetMs: 1200 },
        ],
        "keyboard",
      ),
      { issueToSubmitMs: 2500 },
    );
    check("keyboard-only input is not penalized", kb.score < RISK_HIGH, kb);

    // The keyboard game (key-count) must NOT be an automation blind spot: env +
    // synthetic-event signals now apply there too (they key on automation, not
    // on the pointer, so a real keyboard user is still safe).
    const kbBot = assessBehavior(
      evidenceOf(
        [
          { t: "key-down", targetId: "key-up", offsetMs: 400 },
          { t: "key-down", targetId: "key-right", offsetMs: 600 },
          { t: "key-down", targetId: "key-down", offsetMs: 800 },
          { t: "key-down", targetId: "key-left", offsetMs: 1000 },
        ],
        "keyboard",
        { automationMarkers: 3, untrusted: true },
      ),
      { issueToSubmitMs: 2500 },
    );
    check(
      "keyboard bot (markers + synthetic) is now flagged",
      kbBot.reasons.includes("automation-marker") && kbBot.reasons.includes("synthetic-events"),
      kbBot,
    );
    check("uniform key cadence flagged", kbBot.reasons.includes("uniform-key-cadence"), kbBot);

    // A real keyboard user — clean env, jittered timing — stays at zero.
    const kbHuman = assessBehavior(
      evidenceOf(
        [
          { t: "key-down", targetId: "key-up", offsetMs: 500 },
          { t: "key-down", targetId: "key-right", offsetMs: 690 },
          { t: "key-down", targetId: "key-down", offsetMs: 940 },
          { t: "key-down", targetId: "key-left", offsetMs: 1130 },
        ],
        "keyboard",
        { automationMarkers: 0, untrusted: false, webdriver: false },
      ),
      { issueToSubmitMs: 3000 },
    );
    check("real keyboard user not penalized", kbHuman.score === 0, kbHuman);

    // Phase B/C env+session signals.
    const ev = humanDrag({ x: 18, y: 22 }, { x: 74, y: 66 });
    const cleanBrowser = assessBehavior(
      evidenceOf(ev, "mouse", { webdriver: false, softwareRender: false, headlessHints: 0, pageDwellMs: 9000, interactedBefore: true }),
      { issueToSubmitMs: 3000 },
    );
    check("real browser env signals add nothing", cleanBrowser.score === human.score, cleanBrowser);

    const lazyHeadless = assessBehavior(
      evidenceOf(ev, "mouse", { webdriver: true, softwareRender: true, headlessHints: 3, pageDwellMs: 300, interactedBefore: false }),
      { issueToSubmitMs: 3000 },
    );
    check("lazy headless (all tells) flagged but env capped ≤45", lazyHeadless.score - human.score <= 45 && lazyHeadless.score - human.score >= 30, lazyHeadless);

    // env signals can't block a real-behaving user on their own (capped < 60)
    const swOnly = assessBehavior(
      evidenceOf(ev, "mouse", { softwareRender: true, headlessHints: 1 }),
      { issueToSubmitMs: 3000 },
    );
    check("software-render alone does NOT block (VM/old-GPU safe)", swOnly.score < RISK_HIGH, swOnly);

    // Phase B detection: automation markers + synthetic events.
    const realClean = assessBehavior(
      evidenceOf(ev, "mouse", { automationMarkers: 0, untrusted: false, webdriver: false }),
      { issueToSubmitMs: 3000 },
    );
    check("real browser (0 markers, trusted) adds nothing", realClean.score === human.score, realClean);

    const markers = assessBehavior(
      evidenceOf(ev, "mouse", { automationMarkers: 3 }),
      { issueToSubmitMs: 3000 },
    );
    check("automation markers flagged", markers.reasons.includes("automation-marker") && markers.score > human.score, markers);

    const synthetic = assessBehavior(
      evidenceOf(ev, "mouse", { untrusted: true }),
      { issueToSubmitMs: 3000 },
    );
    check("synthetic (untrusted) events flagged", synthetic.reasons.includes("synthetic-events"), synthetic);

    // Even ALL env tells together stay capped below the block threshold (so a
    // single weird-but-real environment can never block on its own).
    const allEnv = assessBehavior(
      evidenceOf(ev, "mouse", { webdriver: true, softwareRender: true, headlessHints: 3, automationMarkers: 4, untrusted: true, interactedBefore: false, pageDwellMs: 100 }),
      { issueToSubmitMs: 3000 },
    );
    check("env signals capped ≤45 (need behavior to block)", allEnv.score - human.score <= 45, allEnv);
  }

  // ---------------------------------------------------------------------------
  console.log("\n[3a] Invisible-mode probe completeness (no silent pass on a forged stub)");
  {
    // A genuine widget always attaches the FULL collectProbe() shape.
    const realProbe = {
      webdriver: false,
      touch: false,
      softwareRender: false,
      headlessHints: 0,
      automationMarkers: 0,
      interactedBefore: true,
      clientCanary: false,
      pageDwellMs: 4200,
    };
    check("complete real probe is accepted", isCompleteProbe(realProbe) === true);

    // The exact trivial bypass codex flagged: a stub with only pageDwellMs.
    check("forged {pageDwellMs:1} stub is NOT a probe", isCompleteProbe({ pageDwellMs: 1 }) === false);
    check("undefined signals is NOT a probe", isCompleteProbe(undefined) === false);
    check("empty signals object is NOT a probe", isCompleteProbe({}) === false);

    // Partial probes (missing any core field) must not count as a probe, so the
    // invisible check escalates them to a game instead of silent-passing.
    check(
      "probe missing automationMarkers rejected",
      isCompleteProbe({ ...realProbe, automationMarkers: undefined }) === false,
    );
    check(
      "probe missing webdriver rejected",
      isCompleteProbe({ ...realProbe, webdriver: undefined }) === false,
    );
    check(
      "probe missing pageDwellMs rejected",
      isCompleteProbe({ ...realProbe, pageDwellMs: undefined }) === false,
    );
    // Wrong types (a script that sets numbers as strings) are rejected too.
    check(
      "probe with string pageDwellMs rejected",
      isCompleteProbe({ ...realProbe, pageDwellMs: "4200" as unknown as number }) === false,
    );

    // A complete probe that happens to carry automation tells is still a probe
    // (it gets SCORED, not silent-passed and not auto-blocked).
    check(
      "complete probe with tells is still a probe (scored, not bypassed)",
      isCompleteProbe({ ...realProbe, webdriver: true, automationMarkers: 4 }) === true,
    );
  }

  // ---------------------------------------------------------------------------
  console.log("\n[3b] Request signals (Phase A) — no false-positive for real browsers");
  {
    const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
    const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

    const realChrome: RequestEnv = { ua: CHROME, acceptLanguage: "en-US,en;q=0.9", secFetchSite: "same-origin", secChUa: '"Chromium";v="120"', httpProtocol: "HTTP/2", asn: 7922 };
    check("real Chrome (same-origin fetch) scores 0", scoreRequest(realChrome).score === 0, scoreRequest(realChrome));

    // Firefox/Safari on Linux/Mac: no Sec-CH-UA (Chromium-only) must NOT penalize.
    const realFirefoxLinux: RequestEnv = { ua: FIREFOX, acceptLanguage: "en-US,en;q=0.5", secFetchSite: "same-origin", secChUa: null, httpProtocol: "HTTP/2", asn: 3320 };
    check("Firefox on Linux not penalized (no Sec-CH-UA)", scoreRequest(realFirefoxLinux).score === 0, scoreRequest(realFirefoxLinux));
    const realSafari: RequestEnv = { ua: SAFARI, acceptLanguage: "en-US,en;q=0.9", secFetchSite: "same-origin", secChUa: null, httpProtocol: "HTTP/2", asn: 7922 };
    check("Safari not penalized (no Sec-CH-UA)", scoreRequest(realSafari).score === 0, scoreRequest(realSafari));

    // VPN user (datacenter ASN) but otherwise a perfect browser → small, never blocks.
    const vpnChrome: RequestEnv = { ...realChrome, asn: 14061 };
    check("VPN/datacenter ASN alone is small (<30)", scoreRequest(vpnChrome).score < 30 && scoreRequest(vpnChrome).score > 0, scoreRequest(vpnChrome));

    // Python/curl wearing a Chrome UA: missing all browser headers → high.
    const fakeChrome: RequestEnv = { ua: CHROME, acceptLanguage: null, secFetchSite: null, secChUa: null, httpProtocol: "HTTP/1.1", asn: 14061 };
    check("UA-spoofing scripted client scores high", scoreRequest(fakeChrome).score >= 40, scoreRequest(fakeChrome));
  }

  // ---------------------------------------------------------------------------
  console.log("\n[3bb] Transport (TLS) cohort soft-bind — soft, never blocks a real reconnect");
  {
    const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";

    // No stored cohort yet (first request / dev) → nothing to compare → 0.
    check("no stored cohort → no transport signal", scoreTransport("", "abc123", { ua: CHROME, tlsVersion: "TLSv1.3" }).score === 0);
    check("no current cohort (no cf) → no transport signal", scoreTransport("abc123", "", { ua: CHROME, tlsVersion: "" }).score === 0);
    // Same cohort across mint→verify → clean.
    check("matching cohort → no signal", scoreTransport("abc123", "abc123", { ua: CHROME, tlsVersion: "TLSv1.3" }).score === 0);
    // Mint-in-browser, redeem-from-elsewhere → soft shift, but capped well under block.
    const shift = scoreTransport("abc123", "def456", { ua: CHROME, tlsVersion: "TLSv1.3" });
    check("cohort shift flagged soft and < medium (30)", shift.reasons.includes("transport-shift") && shift.score < 30, shift);
    // A modern Chrome UA on antique TLS = scripted client wearing a costume.
    const legacy = scoreTransport("", "", { ua: CHROME, tlsVersion: "TLSv1" });
    check("chromium on legacy TLS flagged", legacy.reasons.includes("legacy-tls-for-chromium") && legacy.score === 8, legacy);
    // Real browsers must never be punished by the coherence check.
    check("chromium on TLS1.3 clean", scoreTransport("", "", { ua: CHROME, tlsVersion: "TLSv1.3" }).score === 0);
    check("firefox on TLS1.2 clean (coherence is chromium-only)", scoreTransport("", "", { ua: FIREFOX, tlsVersion: "TLSv1.2" }).score === 0);

    // Cohort hashing: deterministic, secret-keyed, 16-hex, and inert without TLS.
    const t = { tlsVersion: "TLSv1.3", tlsCipher: "AEAD-AES128-GCM-SHA256", ua: CHROME };
    const a = await transportCohort(ENV, t);
    const b = await transportCohort(ENV, t);
    check("cohort deterministic + 16 hex", a === b && /^[0-9a-f]{16}$/.test(a), a);
    check("different cipher → different cohort", (await transportCohort(ENV, { ...t, tlsCipher: "ECDHE-RSA-AES256" })) !== a);
    check("missing TLS → inert empty cohort", (await transportCohort(ENV, { tlsVersion: "", tlsCipher: "", ua: CHROME })) === "");
    check("partial TLS (cipher only) → inert empty cohort", (await transportCohort(ENV, { tlsVersion: "", tlsCipher: "x", ua: CHROME })) === "");
  }

  // ---------------------------------------------------------------------------
  console.log("\n[3bc] Abuse reputation (Phase E) — repeat offenders, never real users");
  {
    // A real user has zero recent failures → zero reputation risk (unchanged).
    check("no failures → no reputation signal", reputationScore(0, 0).score === 0);
    check("no failures → no reasons", reputationScore(0, 0).reasons.length === 0);

    // Per-IP failures accrue, but stay capped well below the block line.
    const one = reputationScore(1, 0);
    check("one IP failure flagged + small", one.reasons.includes("ip-recent-fails") && one.score === 6, one);
    check("IP failures capped at +24 (< block 60)", reputationScore(100, 0).score === 24);

    // Per-ASN is weak and only kicks in after sustained abuse; capped at +8.
    check("few ASN failures ignored (<5)", reputationScore(0, 4).score === 0);
    const asn = reputationScore(0, 10);
    check("sustained ASN abuse adds a weak nudge", asn.reasons.includes("asn-recent-fails") && asn.score > 0, asn);
    check("ASN nudge capped at +8", reputationScore(0, 10_000).score === 8);

    // Even the worst combined reputation can't block alone (stays < 60).
    check("max reputation (IP+ASN) stays < block 60", reputationScore(100, 10_000).score === 32);
  }

  // ---------------------------------------------------------------------------
  console.log("\n[3c] Token bucket (Phase F) — exact, race-free counter logic");
  {
    // limit 10 / 60s → capacity 10, refill 10/60 per sec.
    const cap = 10, refill = 10 / 60;
    let s = takeToken(null, { cost: 1, capacity: cap, refillPerSec: refill, nowMs: 1000 });
    check("first request allowed", s.allowed && s.state.tokens === 9);
    // Spend the burst within the same instant (no refill) → 10 allowed, 11th denied.
    let st = null as Parameters<typeof takeToken>[0];
    let allowedCount = 0;
    for (let i = 0; i < 12; i++) {
      const r = takeToken(st, { cost: 1, capacity: cap, refillPerSec: refill, nowMs: 5000 });
      if (r.allowed) allowedCount++;
      st = r.state;
    }
    check("burst capped at capacity (10 allowed, rest denied)", allowedCount === 10, allowedCount);
    // After the window the bucket refills.
    const later = takeToken(st, { cost: 1, capacity: cap, refillPerSec: refill, nowMs: 5000 + 60_000 });
    check("refills after the window", later.allowed, later);
    // Never exceeds capacity even after a long idle.
    const idle = takeToken({ tokens: 0, ts: 0 }, { cost: 1, capacity: cap, refillPerSec: refill, nowMs: 10_000_000 });
    check("refill clamps to capacity", idle.state.tokens <= cap - 1, idle.state.tokens);
  }

  // ---------------------------------------------------------------------------
  console.log("\n[4] Game validators — correct play passes, cheats fail");
  {
    const TOL = 1.3;
    for (const type of Object.keys(GAME_PLUGINS) as GameType[]) {
      const g = generateGame([type], "easy");
      const plugin = GAME_PLUGINS[type];
      const built = buildCorrectPlay(type, g);
      if (!built) {
        check(`${type}: solver present`, false, "no solver");
        continue;
      }
      const okHuman = plugin.validate({
        payload: g.payload,
        secret: g.secret,
        answer: built.answer,
        events: built.events,
        inputMode: built.inputMode,
        tolerance: TOL,
      });
      check(`${type}: correct answer + human play passes`, okHuman, built.answer);

      // Right answer, but NO interaction → must fail (defeats "POST the answer").
      const noInteraction = plugin.validate({
        payload: g.payload,
        secret: g.secret,
        answer: built.answer,
        events: [],
        inputMode: "mouse",
        tolerance: TOL,
      });
      check(`${type}: correct answer WITHOUT interaction fails`, !noInteraction);

      // Wrong answer with full interaction → must fail.
      if (built.wrongAnswer !== undefined) {
        const wrong = plugin.validate({
          payload: g.payload,
          secret: g.secret,
          answer: built.wrongAnswer,
          events: built.events,
          inputMode: built.inputMode,
          tolerance: TOL,
        });
        check(`${type}: wrong answer fails`, !wrong, built.wrongAnswer);
      }
    }

    // Teleport drag (answer right, but no movement) fails the move-count floor.
    const drag = generateGame(["drag-target"], "easy");
    const dp = drag.payload as { objects: { id: string; pos: ScenePoint }[]; ring: { pos: ScenePoint } };
    const subjectId = (drag.secret as { correctId: string }).correctId;
    const subj = dp.objects.find((o) => o.id === subjectId)!;
    const teleport = GAME_PLUGINS["drag-target"].validate({
      payload: drag.payload,
      secret: drag.secret,
      answer: { objectId: subjectId },
      events: [
        { t: "pointer-down", x: subj.pos.x, y: subj.pos.y, offsetMs: 100 },
        { t: "pointer-up", x: dp.ring.pos.x, y: dp.ring.pos.y, offsetMs: 130 },
      ],
      inputMode: "mouse",
      tolerance: 1.3,
    });
    check("drag-target: teleport (no moves) fails", !teleport);
  }

  // ---------------------------------------------------------------------------
  console.log("\n[5] Deception — decoys vary, traps catch bypass pokes, fail-closed");
  {
    const none = () => undefined;
    const det = (body: unknown, token?: unknown, hdr?: (n: string) => string | undefined, q?: (n: string) => string | undefined) =>
      detectDeception({ body, header: hdr ?? none, query: q ?? none, token });

    const d1 = generateDecoys();
    const d2 = generateDecoys();
    check("decoys are non-empty", Object.keys(d1).length >= 6, d1);
    check("decoys always include the bypassEligible bait", "bypassEligible" in d1 && "bypassEligible" in d2);
    check(
      "decoy shape varies between challenges",
      JSON.stringify(d1) !== JSON.stringify(d2),
    );

    // Canary / bypass fields (spec list).
    check("bypass:true caught", det({ bypass: true }) === "FAKE_BYPASS_PARAMETER_USED");
    check("skipChallenge caught", det({ skipChallenge: true }) === "FAKE_BYPASS_PARAMETER_USED");
    check("debugPass caught", det({ debugPass: 1 }) === "FAKE_BYPASS_PARAMETER_USED");
    check("captchaPassed override caught", det({ captchaPassed: true }) === "CLIENT_TRUST_OVERRIDE_ATTEMPT");
    check("adminBypass override caught", det({ adminBypass: "true" }) === "CLIENT_TRUST_OVERRIDE_ATTEMPT");
    check("flipped bypassEligible caught", det({ bypassEligible: true }) === "TAMPERED_PUBLIC_PAYLOAD");
    check("flipped policy.enforce caught", det({ policy: { enforce: false } }) === "TAMPERED_PUBLIC_PAYLOAD");
    check("decoy header caught", det({}, undefined, (n) => (n === "x-captcha-debug" ? "true" : undefined)) === "DECOY_HEADER_PRESENT");
    check("bypass query caught", det({}, undefined, none, (n) => (n === "bypass" ? "1" : undefined)) === "FAKE_BYPASS_PARAMETER_USED");
    check("decoy token in field caught", det({ humanToken: "ag_decoy_deadbeef" }) === "DECOY_TOKEN_USED");

    // Clean requests are never flagged (no false positives).
    check("clean verify body NOT flagged", det({ ref: "hc1_x", gameId: "a", answer: { pos: 5 }, evidence: {} }) === null);
    check("falsy trap keys NOT flagged", det({ debug: false, bypass: 0, policy: { enforce: true }, bypassEligible: false }) === null);
    check("real hv1 token NOT a decoy", det({ humanToken: "hv1_" + "a".repeat(64) }) === null);

    // Decoy tokens are fail-closed by construction.
    check("decoyToken has distinct prefix", decoyToken().startsWith("ag_decoy_"));
    check("isDecoyToken flags decoy, not real", isDecoyToken("ag_decoy_x") && !isDecoyToken("hv1_" + "a".repeat(64)));
    check("decoyResponse token never collides with real hv1", !(decoyResponse().token as string).startsWith("hv1_"));

    // Client-side success canary tampering caught (reported in evidence.signals).
    check("client canary tamper caught", det({ evidence: { signals: { clientCanary: true } } }) === "CLIENT_CANARY_SET");
    check("untampered client canary not flagged", det({ evidence: { signals: { clientCanary: false } } }) === null);

    // Honey refs: stateless HMAC-signed, distinct namespace, never a real token.
    const hr = await issueHoneyRef(ENV, "FAKE_BYPASS_PARAMETER_USED");
    check("honey ref format (hcH_)", isHoneyRef(hr) && !hr.startsWith("hc1_"));
    check("honey ref verifies + carries reason", (await verifyHoneyRef(ENV, hr))?.reason === "FAKE_BYPASS_PARAMETER_USED");
    check("forged honey ref rejected", (await verifyHoneyRef(ENV, "hcH_eyJ4Ijoxfg.deadbeef")) === null);
    check("real hc1 ref is not honey", !isHoneyRef("hc1_" + "a".repeat(64)));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

// --- per-game correct-play builders (compute answer from the public payload +
// the secret, and synthesize human-like interaction that supports it) ---------

interface Play {
  answer: unknown;
  events: CaptchaEvent[];
  inputMode: CaptchaInputMode;
  wrongAnswer?: unknown;
}

function buildCorrectPlay(
  type: GameType,
  g: { payload: unknown; secret: unknown },
): Play | null {
  const secret = g.secret as Record<string, unknown>;
  switch (type) {
    case "tap-match": {
      const p = g.payload as { objects: { id: string; pos: ScenePoint }[] };
      const id = secret.correctId as string;
      const obj = p.objects.find((o) => o.id === id)!;
      const wrong = p.objects.find((o) => o.id !== id)!;
      return {
        answer: { objectId: id },
        events: [tapEvent(obj.pos, 600), { t: "pointer-up", x: obj.pos.x, y: obj.pos.y, offsetMs: 690 }],
        inputMode: "touch",
        wrongAnswer: { objectId: wrong.id },
      };
    }
    case "drag-target": {
      const p = g.payload as { objects: { id: string; pos: ScenePoint }[]; ring: { pos: ScenePoint } };
      const id = secret.correctId as string;
      const obj = p.objects.find((o) => o.id === id)!;
      const wrong = p.objects.find((o) => o.id !== id)!;
      return {
        answer: { objectId: id },
        events: humanDrag(obj.pos, p.ring.pos),
        inputMode: "mouse",
        wrongAnswer: { objectId: wrong.id },
      };
    }
    case "slide": {
      const p = g.payload as { target: number };
      return {
        answer: { pos: p.target },
        events: humanDrag({ x: 8, y: 50 }, { x: p.target, y: 50 }),
        inputMode: "mouse",
        wrongAnswer: { pos: Math.min(100, p.target + 30) },
      };
    }
    case "path-trace": {
      const p = g.payload as { dots: { id: string; pos: ScenePoint }[] };
      const order = secret.order as string[];
      const pts = order.map((id) => p.dots.find((d) => d.id === id)!.pos);
      // one continuous stroke through the dots in order
      const events: CaptchaEvent[] = [{ t: "pointer-down", x: pts[0].x, y: pts[0].y, offsetMs: 200 }];
      let t = 200;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1];
        const b = pts[k];
        for (let i = 1; i <= 8; i++) {
          const u = i / 8;
          t += 22 + (i % 2) * 8;
          events.push({ t: "pointer-move", x: a.x + (b.x - a.x) * u + Math.sin(i) * 0.5, y: a.y + (b.y - a.y) * u, offsetMs: t });
        }
      }
      events.push({ t: "pointer-up", x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, offsetMs: t + 30 });
      return {
        answer: { order },
        events,
        inputMode: "mouse",
        wrongAnswer: { order: [...order].reverse() },
      };
    }
    case "connect": {
      const p = g.payload as { objects: { id: string; pos: ScenePoint }[] };
      const a = secret.aId as string;
      const b = secret.bId as string;
      const oa = p.objects.find((o) => o.id === a)!;
      const ob = p.objects.find((o) => o.id === b)!;
      const other = p.objects.find((o) => o.id !== a && o.id !== b)!;
      return {
        answer: { a, b },
        events: humanDrag(oa.pos, ob.pos),
        inputMode: "mouse",
        wrongAnswer: { a, b: other.id },
      };
    }
    case "sort-3": {
      const p = g.payload as { objects: { id: string; pos: ScenePoint; size: number }[] };
      const order = secret.order as string[];
      const events: CaptchaEvent[] = [];
      let t = 400;
      for (const id of order) {
        const o = p.objects.find((x) => x.id === id)!;
        events.push(tapEvent(o.pos, t));
        t += 500;
      }
      return {
        answer: { order },
        events,
        inputMode: "touch",
        wrongAnswer: { order: [...order].reverse() },
      };
    }
    case "key-count": {
      const seq = (g.payload as { sequence: string[] }).sequence;
      const events: CaptchaEvent[] = [];
      let t = 300;
      seq.forEach((dir, i) => {
        events.push({ t: "key-down", targetId: `key-${dir}`, offsetMs: t });
        t += 150 + (i % 4) * 35; // jittered human cadence (not a metronome)
      });
      return {
        answer: { pressed: seq.length },
        events,
        inputMode: "keyboard",
        wrongAnswer: { pressed: seq.length + 1 },
      };
    }
    case "rotate": {
      const s = g.secret as { targetAngle: number };
      // drag around the pivot → many move events
      const events: CaptchaEvent[] = [{ t: "pointer-down", x: 70, y: 52, offsetMs: 200 }];
      let t = 200;
      for (let i = 1; i <= 12; i++) {
        t += 25 + (i % 2) * 7;
        events.push({ t: "pointer-move", x: 70 - i, y: 52 + i * 0.7, offsetMs: t });
      }
      events.push({ t: "pointer-up", x: 55, y: 60, offsetMs: t + 20 });
      return {
        answer: { angle: s.targetAngle },
        events,
        inputMode: "mouse",
        wrongAnswer: { angle: (s.targetAngle + 90) % 360 },
      };
    }
    default:
      return null;
  }
}

void dist; // (kept for potential future geometry assertions)
main();
