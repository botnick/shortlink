/**
 * Client side of the human check: API calls + the interaction recorder.
 *
 * The recorder captures a COMPACT evidence trail (normalized scene coordinates,
 * throttled moves, hard event cap) — enough for the server's risk engine to see
 * physics, never a raw behavioral log. Nothing here decides pass/fail; the
 * client renders and reports, the server judges.
 */
import { api } from "@/lib/api";
import { collectProbe } from "@/lib/captcha-probe";
import type {
  CaptchaAction,
  CaptchaChallengeDTO,
  CaptchaEvent,
  CaptchaEvidence,
  CaptchaInputMode,
  CaptchaVerifyRequestDTO,
  CaptchaVerifyResponseDTO,
  ScenePoint,
} from "@shared/captcha";

export function mintChallenge(
  action: CaptchaAction,
  accessible = false,
): Promise<CaptchaChallengeDTO> {
  return api.post<CaptchaChallengeDTO>("/captcha/challenge", { action, accessible });
}

export function submitVerify(
  body: CaptchaVerifyRequestDTO,
): Promise<CaptchaVerifyResponseDTO> {
  return api.post<CaptchaVerifyResponseDTO>("/captcha/verify", body);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

type PointerKind = "mouse" | "touch" | "pen";

export class EvidenceRecorder {
  private events: CaptchaEvent[] = [];
  private readonly t0 = performance.now();
  private startedAt: number | null = null;
  private lastMoveAt = -Infinity;
  private modes = new Set<CaptchaInputMode>();
  /** Set once if any pointer event arrives synthetic (isTrusted === false). */
  private sawUntrusted = false;

  constructor(private readonly maxEvents: number) {}

  private offset(): number {
    return Math.max(0, Math.round(performance.now() - this.t0));
  }

  private push(e: CaptchaEvent) {
    if (this.events.length >= this.maxEvents) return; // hard cap — cost control
    if (this.startedAt === null) this.startedAt = e.offsetMs;
    this.events.push(e);
  }

  pointer(
    type: "pointer-down" | "pointer-move" | "pointer-up",
    pt: ScenePoint,
    pointerType: string,
    isTrusted = true,
  ) {
    if (!isTrusted) this.sawUntrusted = true; // synthetic dispatchEvent (bot)
    if (type === "pointer-move") {
      const now = performance.now();
      if (now - this.lastMoveAt < 25) return; // ~40Hz is plenty of physics
      this.lastMoveAt = now;
    }
    const kind: PointerKind =
      pointerType === "touch" || pointerType === "pen" ? pointerType : "mouse";
    this.modes.add(kind);
    this.push({ t: type, x: round1(pt.x), y: round1(pt.y), offsetMs: this.offset() });
  }

  /** Keyboard action on an element; movement keys also carry the piece's
   *  resulting position so the server can verify the journey geometrically. */
  key(targetId: string, pt?: ScenePoint, isTrusted = true) {
    if (!isTrusted) this.sawUntrusted = true; // synthetic dispatchEvent (bot)
    this.modes.add("keyboard");
    this.push({
      t: "key-down",
      targetId,
      ...(pt ? { x: round1(pt.x), y: round1(pt.y) } : {}),
      offsetMs: this.offset(),
    });
  }

  evidence(): CaptchaEvidence {
    const inputMode: CaptchaInputMode =
      this.modes.size === 0
        ? "mouse"
        : this.modes.size === 1
          ? [...this.modes][0]
          : "mixed";
    return {
      startedAtOffsetMs: this.startedAt ?? this.offset(),
      completedAtOffsetMs: this.offset(),
      viewport: {
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
      inputMode,
      events: this.events,
      // Ephemeral, non-fingerprinting environment + session probe (Phase B/C),
      // plus the synthetic-event tell observed during recording. Every field is
      // a soft server-side signal that never blocks alone; an honest browser
      // reports them clean. No persistent identifier is collected.
      signals: { ...collectProbe(), untrusted: this.sawUntrusted },
    };
  }
}
