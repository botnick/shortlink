/**
 * Behavioral risk engine.
 *
 * Two strictly separated classes of signal:
 *
 *  HARD FAILURES — protocol states a genuine client can never produce (time
 *  running backwards, out-of-order events). These reject immediately.
 *
 *  SOFT SIGNALS — each adds a weighted score; NO single soft signal can reach
 *  the default block threshold (60) alone, by construction every weight < 60.
 *  This is the false-positive guard the design demands: a Linux desktop, a
 *  privacy browser, a keyboard-only user, a screen-reader user, a slow network
 *  or a missing touch screen must never be punished — none of those are even
 *  inputs here. Only the physics of the interaction itself is scored.
 */
import type { CaptchaEvidence } from "@shared/captcha";

interface RiskAssessment {
  score: number;
  /** Internal reason codes — server logs only, never sent to the client. */
  reasons: string[];
}

/** Protocol violations a real browser client cannot emit. */
export function hardFailure(evidence: CaptchaEvidence): string | null {
  if (evidence.completedAtOffsetMs < evidence.startedAtOffsetMs) {
    return "time-reversed";
  }
  let prev = -1;
  for (const e of evidence.events) {
    if (e.offsetMs < prev) return "events-out-of-order";
    prev = e.offsetMs;
  }
  return null;
}

interface Positioned {
  x: number;
  y: number;
  offsetMs: number;
}

export function assessBehavior(
  evidence: CaptchaEvidence,
  opts: { issueToSubmitMs: number },
): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(why);
  };

  const duration = Math.max(
    0,
    evidence.completedAtOffsetMs - evidence.startedAtOffsetMs,
  );
  const keyboard = evidence.inputMode === "keyboard";

  if (evidence.events.length === 0) add(45, "no-interaction");

  // Server-side wall clock from game issuance to submit — can't be faked by
  // client timestamps. Humans need time to even *see* the prompt.
  if (opts.issueToSubmitMs < 600) add(20, "instant-submit");

  // Environment/automation signals run for EVERY input mode — including the
  // keyboard game. They target automation (driver globals, synthetic events,
  // headless), not input modality, so a real keyboard / Linux / privacy /
  // screen-reader user is never punished, and the group is capped well below the
  // block threshold. Placed ABOVE the keyboard early-return on purpose:
  // otherwise the accessible game would skip automation detection entirely.
  score += scoreEnv(evidence.signals, reasons);

  if (keyboard) {
    // Keyboard/assistive flows SKIP the pointer-physics heuristics (those would
    // punish exactly the users they must not) — timing + the env signals above
    // are the whole check.
    if (duration < 250) add(20, "too-fast");
    // Uniform keystroke cadence: a person's inter-key gaps jitter; a scripted
    // loop emits them on a fixed interval. Needs ≥4 presses; soft and capped,
    // so a real keyboard user with a steady rhythm is never blocked on it alone.
    const keys = evidence.events.filter((e) => e.t === "key-down");
    if (keys.length >= 4) {
      const buckets = new Set<number>();
      for (let i = 1; i < keys.length; i++) {
        buckets.add(Math.round((keys[i].offsetMs - keys[i - 1].offsetMs) / 8));
      }
      if (buckets.size <= 1) add(18, "uniform-key-cadence");
    }
    return { score, reasons };
  }

  if (duration < 350) add(25, "too-fast");
  if (duration < 120) add(20, "way-too-fast");

  const moves: Positioned[] = [];
  for (const e of evidence.events) {
    if (e.t === "pointer-move" && typeof e.x === "number" && typeof e.y === "number") {
      moves.push({ x: e.x, y: e.y, offsetMs: e.offsetMs });
    }
  }

  // Per-segment geometry/kinematics — the heart of automation detection. Real
  // human drags curve, vary their speed (accelerate then decelerate), and jitter
  // their cadence. Playwright/Puppeteer/CDP synthesize moves as a straight line
  // of EQUAL steps at CONSTANT speed on a UNIFORM clock — each property below is
  // one of those tells. All soft (each < the block threshold) so no real human
  // trips the gate on a single quirk.
  const seg: { len: number; dt: number; speed: number }[] = [];
  for (let i = 1; i < moves.length; i++) {
    const len = Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y);
    const dt = Math.max(1, moves[i].offsetMs - moves[i - 1].offsetMs);
    seg.push({ len, dt, speed: len / dt });
    if (len > 45 && moves[i].offsetMs - moves[i - 1].offsetMs < 10) {
      // Teleport step inside a "drag" — a real pointer can't cross the scene in
      // under a frame.
      add(15, "teleport");
      break;
    }
  }

  if (moves.length >= 8) {
    const a = moves[0];
    const b = moves[moves.length - 1];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);

    // Ruler-straight path: max perpendicular deviation from the chord. Humans
    // wobble; CDP point-to-point is dead straight.
    if (chord > 10) {
      let maxDev = 0;
      for (const m of moves) {
        const dev =
          Math.abs((b.x - a.x) * (a.y - m.y) - (a.x - m.x) * (b.y - a.y)) / chord;
        if (dev > maxDev) maxDev = dev;
      }
      if (maxDev < 0.4) add(22, "ruler-line");
    }

    // Equal-length segments: Playwright's `mouse.move(...,{steps:N})` divides
    // the path into identical hops. Low spread in segment length = synthetic.
    const lens = seg.map((s) => s.len).filter((l) => l > 0.5);
    if (lens.length >= 6 && coVar(lens) < 0.15) add(22, "equal-segments");

    // Constant velocity: a human's speed rises and falls across a drag (a wide
    // spread); a scripted move holds one speed (a narrow one).
    const speeds = seg.map((s) => s.speed).filter((v) => v > 0);
    if (speeds.length >= 6 && coVar(speeds) < 0.2) add(22, "constant-velocity");
  }

  // Metronome cadence: real pointer streams jitter (vsync mixes 16/17ms, the
  // recorder throttle adds more). ≥10 intervals ALL identical to the millisecond
  // is a script loop, not a hand.
  if (moves.length >= 11) {
    const intervals = new Set<number>();
    for (let i = 1; i < moves.length; i++) {
      intervals.add(Math.round(moves[i].offsetMs - moves[i - 1].offsetMs));
    }
    if (intervals.size <= 1) add(22, "uniform-cadence");
  }

  return { score, reasons };
}

/**
 * Passive confidence check for INVISIBLE mode (no game played). Scores ONLY the
 * environment/automation probe — webdriver, headless hints, automation-driver
 * globals, synthetic events, a no-interaction+instant arrival — and NEVER the
 * pointer-physics or the blanket "no-interaction" penalty, which both assume a
 * game was actually played and would punish every legitimate silent user. An
 * honest browser scores ~0 and passes with zero UI; lazy/default automation tips
 * over the medium-risk line and is handed one easy game.
 */
export function assessPassive(evidence: CaptchaEvidence): RiskAssessment {
  const reasons: string[] = [];
  // Skip the "no-page-interaction" penalty here: on the invisible auto-check the
  // probe runs BEFORE the user touches the form, so it would fire for every
  // genuine user too (a false-positive). Only the automation tells count.
  const score = scoreEnv(evidence.signals, reasons, { skipInteraction: true });
  return { score, reasons };
}

/**
 * Is this the full probe a genuine widget always attaches (`collectProbe`)?
 *
 * A real probe carries every one of these — booleans for webdriver /
 * softwareRender / interactedBefore and numbers for headlessHints /
 * automationMarkers / pageDwellMs. A script that hand-rolls a stub to look
 * "probed" (e.g. `{signals:{pageDwellMs:1500}}`) fails this and is treated as
 * NO probe by the invisible auto-check — so it can never silently pass on a
 * single forged field; it must play a game. Tightening this never blocks a real
 * user (their probe is always complete); it only denies the silent pass to a
 * partial forgery.
 */
export function isCompleteProbe(sig: CaptchaEvidence["signals"] | undefined): boolean {
  if (!sig) return false;
  return (
    typeof sig.pageDwellMs === "number" &&
    typeof sig.headlessHints === "number" &&
    typeof sig.automationMarkers === "number" &&
    typeof sig.webdriver === "boolean" &&
    typeof sig.softwareRender === "boolean" &&
    typeof sig.interactedBefore === "boolean"
  );
}

// --- Phase B/C: environment + session signals --------------------------------
/** All client-reported and trivially spoofable, so individually weak and, as a
 *  group, capped well below the block threshold — they can never block a real
 *  person on their own (honoring "headless/webdriver/Linux/privacy ≠ bot"). They
 *  exist to tip a borderline, behaviorally-suspicious submission, and to catch
 *  lazy default automation that doesn't bother faking them. Applied to EVERY
 *  input mode (the keyboard game included), since they key on automation, not
 *  on how the user pointed. Returns the (capped) contribution; pushes reasons. */
function scoreEnv(
  sig: CaptchaEvidence["signals"],
  reasons: string[],
  opts: { skipInteraction?: boolean } = {},
): number {
  if (!sig) return 0;
  let envScore = 0;
  const envAdd = (n: number, why: string) => {
    envScore += n;
    reasons.push(why);
  };
  if (sig.webdriver === true) envAdd(12, "webdriver-hint");
  if (sig.softwareRender === true) envAdd(14, "software-render");
  if (typeof sig.headlessHints === "number" && sig.headlessHints >= 2) {
    envAdd(12, "headless-hints");
  }
  // Automation-driver globals (chromedriver/Selenium/Playwright/Puppeteer…). A
  // real browser injects none; a careful attacker strips them, so it's soft.
  if (typeof sig.automationMarkers === "number" && sig.automationMarkers >= 1) {
    envAdd(16, "automation-marker");
  }
  // Synthetic events (isTrusted=false), pointer OR key — naive dispatchEvent
  // automation. A real user's input is always trusted: a high-confidence tell.
  if (sig.untrusted === true) envAdd(18, "synthetic-events");
  // Submitted almost instantly AND never touched the page first → scripted
  // arrival. Requires BOTH so a fast genuine user (who DID interact) is safe.
  if (
    !opts.skipInteraction &&
    sig.interactedBefore === false &&
    typeof sig.pageDwellMs === "number" &&
    sig.pageDwellMs < 800
  ) {
    envAdd(12, "no-page-interaction");
  }
  // Cap the whole environment/session contribution so it can never reach the
  // block threshold by itself — behavioral evidence must corroborate, and no
  // single real-user quirk is ever enough.
  return Math.min(envScore, 45);
}

/** Coefficient of variation (stdev / mean). Scale-free spread measure — low
 *  means suspiciously uniform. */
function coVar(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return 1;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
}
