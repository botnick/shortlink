/**
 * Unit tests for the HumanCheck behavioral risk hardening
 * (worker/lib/captcha/risk.ts assessBehavior). Run: `npx tsx tests/captcha-risk.ts`.
 *
 * Closes the assessment gap: tap-only / teleport scripts that used to score ~0
 * (the move-physics checks never fired) must now accrue soft risk, while a
 * varied human interaction stays clean.
 */
import { assessBehavior } from "../worker/lib/captcha/risk";
import type { CaptchaEvidence, CaptchaEvent, CaptchaSignals } from "@shared/captcha";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  ✓", label);
  } else {
    fail++;
    console.log("  ✗", label);
  }
}

const benign: CaptchaSignals = {
  webdriver: false,
  touch: false,
  softwareRender: false,
  headlessHints: 0,
  pageDwellMs: 6000,
  interactedBefore: true,
  automationMarkers: 0,
  clientCanary: false,
  untrusted: false,
};

function ev(events: CaptchaEvent[]): CaptchaEvidence {
  return {
    startedAtOffsetMs: 1000,
    completedAtOffsetMs: 3200,
    viewport: { w: 1280, h: 720, dpr: 1 },
    inputMode: "mouse",
    events,
    signals: benign,
  };
}
const opts = (gameType: string) => ({ issueToSubmitMs: 3000, gameType });
const has = (r: { reasons: string[] }, code: string) => r.reasons.includes(code);

// 1. Scripted tap game: identical press durations + identical inter-tap gaps.
const scriptedTaps: CaptchaEvent[] = [
  { t: "pointer-down", x: 55, y: 25, offsetMs: 1000 },
  { t: "pointer-up", x: 55, y: 25, offsetMs: 1050 },
  { t: "pointer-down", x: 27, y: 46, offsetMs: 2000 },
  { t: "pointer-up", x: 27, y: 46, offsetMs: 2050 },
  { t: "pointer-down", x: 89, y: 33, offsetMs: 3000 },
  { t: "pointer-up", x: 89, y: 33, offsetMs: 3050 },
];
const r1 = assessBehavior(ev(scriptedTaps), opts("sort-3"));
check("scripted taps → uniform-tap-press", has(r1, "uniform-tap-press"));
check("scripted taps → uniform-tap-cadence", has(r1, "uniform-tap-cadence"));
check("scripted taps cross medium (>=30)", r1.score >= 30);

// 2. Drag game claimed but no motion (teleport down→up).
const teleportConnect: CaptchaEvent[] = [
  { t: "pointer-down", x: 20, y: 50, offsetMs: 1200 },
  { t: "pointer-up", x: 80, y: 25, offsetMs: 1900 },
];
const r2 = assessBehavior(ev(teleportConnect), opts("connect"));
check("drag with no motion → drag-without-motion", has(r2, "drag-without-motion"));
check("drag-without-motion crosses medium", r2.score >= 30);

// 3. Human-like taps: varied press lengths AND gaps → no uniform penalties.
const humanTaps: CaptchaEvent[] = [
  { t: "pointer-down", x: 55, y: 25, offsetMs: 1000 },
  { t: "pointer-up", x: 55, y: 25, offsetMs: 1078 },
  { t: "pointer-down", x: 27, y: 46, offsetMs: 1840 },
  { t: "pointer-up", x: 27, y: 46, offsetMs: 1953 },
  { t: "pointer-down", x: 89, y: 33, offsetMs: 3010 },
  { t: "pointer-up", x: 89, y: 33, offsetMs: 3055 },
];
const r3 = assessBehavior(ev(humanTaps), opts("sort-3"));
check("human taps → no uniform-tap-press", !has(r3, "uniform-tap-press"));
check("human taps → no uniform-tap-cadence", !has(r3, "uniform-tap-cadence"));
check("human taps stay below medium", r3.score < 30);

// 4. Real drag with varied moves → no drag-without-motion.
const realDrag: CaptchaEvent[] = [{ t: "pointer-down", x: 20, y: 50, offsetMs: 1000 }];
for (let i = 1; i <= 8; i++) {
  realDrag.push({
    t: "pointer-move",
    x: 20 + i * 7 + (i % 2),
    y: 50 - i * 3 + (i % 3),
    offsetMs: 1000 + i * 90 + (i % 4) * 7,
  });
}
realDrag.push({ t: "pointer-up", x: 80, y: 26, offsetMs: 1850 });
const r4 = assessBehavior(ev(realDrag), opts("connect"));
check("real drag → no drag-without-motion", !has(r4, "drag-without-motion"));
check("real drag (8 moves) → no low-move-drag", !has(r4, "low-move-drag"));

// 5. A few interpolated hops: clears a validator move-floor but is far short of
//    a real ~40Hz stream → low-move-drag (soft).
const fewHops: CaptchaEvent[] = [{ t: "pointer-down", x: 20, y: 50, offsetMs: 1000 }];
for (let i = 1; i <= 5; i++) {
  fewHops.push({ t: "pointer-move", x: 20 + i * 11, y: 50 - i * 4, offsetMs: 1000 + i * 120 });
}
fewHops.push({ t: "pointer-up", x: 80, y: 26, offsetMs: 1700 });
const r5 = assessBehavior(ev(fewHops), opts("slide"));
check("few drag hops → low-move-drag", has(r5, "low-move-drag"));

// 6. Scripted KEYBOARD sequence with metronomic cadence → uniform-key-cadence,
//    weighted so two such rounds reach the block line via the accumulator.
const scriptedKeys: CaptchaEvent[] = [];
for (let i = 0; i < 4; i++) {
  scriptedKeys.push({ t: "key-down", targetId: "key-up", offsetMs: 1000 + i * 500 });
}
const rk = assessBehavior({ ...ev(scriptedKeys), inputMode: "keyboard" }, opts("key-count"));
check("scripted keys → uniform-key-cadence", has(rk, "uniform-key-cadence"));
check("scripted keys reach medium (>=30)", rk.score >= 30);

// 7. Human keyboard: jittered inter-key gaps → no uniform-key-cadence.
const humanKeys: CaptchaEvent[] = [
  { t: "key-down", targetId: "key-up", offsetMs: 1000 },
  { t: "key-down", targetId: "key-left", offsetMs: 1480 },
  { t: "key-down", targetId: "key-down", offsetMs: 2090 },
  { t: "key-down", targetId: "key-right", offsetMs: 2510 },
];
const rhk = assessBehavior({ ...ev(humanKeys), inputMode: "keyboard" }, opts("key-count"));
check("human keys → no uniform-key-cadence", !has(rhk, "uniform-key-cadence"));

console.log(`\ncaptcha-risk: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
