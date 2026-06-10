/**
 * Sort three — "Tap the stars from smallest to largest."
 * Exactly three pieces of one shape with unmistakably different sizes. The
 * answer is the tapped order, and each tap must land on its piece in that
 * order. Three pieces only, ever — sorting more is a chore, not a check.
 *
 * Note (honest threat model): size MUST be on the wire for the client to draw
 * the pieces, so the order is structurally derivable from the payload here —
 * this game leans entirely on the interaction proof (three ordered taps with
 * real pointer-downs) plus the proof-of-work + single-use economics, not on
 * answer secrecy. It's off by default for that reason.
 */
import type { SortPayload } from "@shared/captcha";
import { pick, randFloat, shuffle } from "../rng";
import {
  COLORS,
  SHAPES,
  SHAPE_NAME,
  asStringArray,
  asRecord,
  dist,
  makeObject,
  placePoints,
} from "./helpers";
import type { GamePlugin, GameValidateInput } from "./types";

type Secret = {
  order: string[]; // small → large
};

export const sortThree: GamePlugin = {
  type: "sort-3",

  generate() {
    const subjectShape = shuffle(SHAPES)[0];
    const color = pick(COLORS);
    // ~1 : 1.5 : 2.1 size ratio — obvious at a glance, no squinting required.
    const sizes = [randFloat(5.5, 6.5), randFloat(8.5, 9.5), randFloat(12, 13.5)];
    const positions = placePoints(3, 13, { gap: 7 });
    const pieces = sizes.map((size, i) =>
      makeObject({ shape: subjectShape, color, pos: positions[i], size }),
    );

    const payload: SortPayload = {
      game: "sort-3",
      objects: shuffle(pieces),
    };
    const secret: Secret = { order: pieces.map((p) => p.id) };
    return {
      type: "sort-3",
      prompt: `Tap the ${SHAPE_NAME[subjectShape]}s from smallest to largest`,
      payload,
      secret,
    };
  },

  validate({ payload, secret, answer, events, tolerance }: GameValidateInput) {
    const p = payload as SortPayload;
    const s = secret as unknown as Secret;
    const a = asRecord(answer);
    const order = a ? asStringArray(a.order) : null;
    if (!order || order.length !== s.order.length) return false;
    if (!order.every((id, i) => id === s.order[i])) return false;

    // Keyboard: the first N activations must hit the pieces in size order.
    const keys = events
      .filter((e) => e.t === "key-down" && typeof e.targetId === "string")
      .map((e) => e.targetId as string);
    if (keys.length >= order.length) {
      return order.every((id, i) => keys[i] === id);
    }

    // Pointer: pin the k-th TAP to the k-th piece by order — not a global scan.
    // (The big piece's hit radius overlaps the small one, so scanning from 0
    // would let one tap satisfy two pieces and wrongly reject a real human.)
    const taps = events.filter(
      (e): e is typeof e & { x: number; y: number } =>
        e.t === "pointer-down" && typeof e.x === "number" && typeof e.y === "number",
    );
    if (taps.length < order.length) return false;
    for (let k = 0; k < order.length; k++) {
      const obj = p.objects.find((o) => o.id === order[k]);
      if (!obj) return false;
      if (dist({ x: taps[k].x, y: taps[k].y }, obj.pos) > (obj.size * 2 + 6) * tolerance) {
        return false;
      }
    }
    return true;
  },
};
