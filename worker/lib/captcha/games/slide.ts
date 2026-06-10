/**
 * Slide to the notch — the v2 favourite, back as a v3 plugin. Drag the handle
 * along a track until it sits in the marked notch. The target is necessarily
 * shown (you have to aim at it), so — like sort-by-size — the answer is
 * structural, not secret; the moat is identical to every other game: a
 * proof-of-work per attempt, a single-use challenge, and a REAL drag that
 * actually travels to the notch (a teleport with no movement fails). Works with
 * a pointer or the arrow keys.
 */
import type { SlidePayload } from "@shared/captcha";
import { pick, randInt } from "../rng";
import { COLORS, asRecord, countMoves } from "./helpers";
import type { GamePlugin, GameValidateInput } from "./types";

type Secret = {
  target: number;
  tolerance: number;
};

// Generous tolerance — a track is not a surgical instrument. Scaled further by
// the admin tolerance profile.
const TOLERANCE = { easy: 7, normal: 5.5, hard: 4 } as const;

export const slide: GamePlugin = {
  type: "slide",

  generate({ difficulty }) {
    // Keep the notch away from the edges so "do nothing" never lands it.
    const target = randInt(22, 82);
    const payload: SlidePayload = { game: "slide", target, color: pick(COLORS) };
    const secret: Secret = { target, tolerance: TOLERANCE[difficulty] };
    return {
      type: "slide",
      prompt: "Slide the handle into the notch",
      payload,
      secret,
    };
  },

  validate({ secret, answer, events, inputMode, tolerance }: GameValidateInput) {
    const s = secret as unknown as Secret;
    const a = asRecord(answer);
    if (!a || typeof a.pos !== "number" || !Number.isFinite(a.pos)) return false;
    if (Math.abs(a.pos - s.target) > s.tolerance * tolerance) return false;
    // Keyboard users step with the arrow keys; pointer users must actually drag
    // (a no-movement "drop" on target is a teleport).
    if (inputMode === "keyboard") {
      return events.some((e) => e.t === "key-down");
    }
    return countMoves(events) >= 3;
  },
};
