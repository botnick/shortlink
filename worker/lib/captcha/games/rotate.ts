/**
 * Rotate the arrow — "Turn the arrow to point at the dot."
 * The dot sits at a random angle on a ring around the arrow. Both the starting
 * angle and the target are random every time, and the final answer must come
 * with real rotation gestures in the evidence.
 */
import type { RotatePayload } from "@shared/captcha";
import { SCENE_H } from "@shared/captcha";
import { pick, randFloat } from "../rng";
import { COLORS, angDiff, asRecord } from "./helpers";
import type { GamePlugin, GameValidateInput } from "./types";

type Secret = {
  targetAngle: number;
  tolerance: number;
};

// Generous by design (a thumb on a phone is not a protractor); the admin
// tolerance profile scales these further.
const TOLERANCE = { easy: 18, normal: 14, hard: 11 } as const;

export const rotate: GamePlugin = {
  type: "rotate",

  generate({ difficulty }) {
    const targetAngle = randFloat(0, 360);
    // Start the arrow well away from the target so "do nothing" never passes.
    let initial = targetAngle + randFloat(70, 290);
    initial = ((initial % 360) + 360) % 360;

    const payload: RotatePayload = {
      game: "rotate",
      arrow: {
        pos: { x: 50, y: SCENE_H / 2 },
        size: randFloat(12, 15),
        angle: initial,
        color: pick(COLORS),
      },
      dot: {
        angle: targetAngle,
        radius: randFloat(22, 26),
        size: randFloat(3.5, 4.5),
        color: pick(COLORS),
      },
    };
    const secret: Secret = {
      targetAngle,
      tolerance: TOLERANCE[difficulty],
    };
    return {
      type: "rotate",
      prompt: "Turn the arrow to point at the dot",
      payload,
      secret,
    };
  },

  validate({ secret, answer, events, tolerance }: GameValidateInput) {
    const s = secret as unknown as Secret;
    const a = asRecord(answer);
    if (!a || typeof a.angle !== "number" || !Number.isFinite(a.angle)) {
      return false;
    }
    if (angDiff(a.angle, s.targetAngle) > s.tolerance * tolerance) return false;
    // The rotation must have been *performed*: drag movement or arrow-key steps.
    const gestures = events.filter(
      (e) => e.t === "pointer-move" || e.t === "key-down",
    );
    return gestures.length >= 2;
  },
};
