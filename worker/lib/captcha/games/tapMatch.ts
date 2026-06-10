/**
 * Tap the matching shape — "Tap the star."
 * Exactly one object matches the prompted shape; decoys are all other shapes.
 * Fastest game in the pool (one tap), ideal for invisible-mode escalation.
 */
import type { TapMatchPayload } from "@shared/captcha";
import { randFloat, shuffle } from "../rng";
import {
  COLORS,
  SHAPES,
  SHAPE_NAME,
  asRecord,
  makeObject,
  placePoints,
  tapIndexFor,
} from "./helpers";
import type { GamePlugin, GameValidateInput } from "./types";

type Secret = {
  correctId: string;
};

const COUNT = { easy: 4, normal: 5, hard: 6 } as const;

export const tapMatch: GamePlugin = {
  type: "tap-match",

  generate({ difficulty }) {
    const count = COUNT[difficulty];
    const shapes = shuffle(SHAPES);
    const subjectShape = shapes[0];
    const positions = placePoints(count, 11, { gap: 7 });
    const colors = shuffle(COLORS);

    const objects = positions.map((pos, i) =>
      makeObject({
        shape: shapes[i % shapes.length],
        color: colors[i % colors.length],
        pos,
        size: randFloat(9, 11),
      }),
    );
    const subject = objects[0]; // shapes[0] is unique — shapes[] has no repeats at n ≤ 6

    const payload: TapMatchPayload = {
      game: "tap-match",
      objects: shuffle(objects),
    };
    const secret: Secret = { correctId: subject.id };
    return {
      type: "tap-match",
      prompt: `Tap the ${SHAPE_NAME[subjectShape]}`,
      payload,
      secret,
    };
  },

  validate({ payload, secret, answer, events, tolerance }: GameValidateInput) {
    const p = payload as TapMatchPayload;
    const s = secret as unknown as Secret;
    const a = asRecord(answer);
    if (!a || a.objectId !== s.correctId) return false;
    const obj = p.objects.find((o) => o.id === s.correctId);
    if (!obj) return false;
    // The tap (or keyboard activation) must actually land on the object.
    return tapIndexFor(events, obj, (obj.size * 2 + 6) * tolerance) !== -1;
  },
};
