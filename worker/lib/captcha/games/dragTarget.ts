/**
 * Drag to target — "Drag the star into the dashed ring."
 * One subject shape among decoy shapes; a single dashed drop ring. The answer
 * is which object was dropped, and the recorded path must actually travel from
 * the object to the ring (a screenshot of the final frame proves nothing).
 */
import type { DragTargetPayload } from "@shared/captcha";
import { randFloat, shuffle } from "../rng";
import {
  COLORS,
  SHAPES,
  SHAPE_NAME,
  asRecord,
  countMoves,
  firstIndexNear,
  keyTargetSequence,
  lastIndexNear,
  makeObject,
  pathPoints,
  placePoints,
} from "./helpers";
import type { GamePlugin, GameValidateInput } from "./types";

type Secret = {
  correctId: string;
};

const DECOYS = { easy: 2, normal: 3, hard: 4 } as const;

export const dragTarget: GamePlugin = {
  type: "drag-target",

  generate({ difficulty }) {
    const decoyCount = DECOYS[difficulty];
    const shapes = shuffle(SHAPES);
    const subjectShape = shapes[0];
    const size = randFloat(8.5, 10.5);
    const ringSize = size * 1.6;

    // Ring first, then pieces placed clear of it.
    const [ringPos] = placePoints(1, ringSize, { margin: ringSize + 8 });
    const positions = placePoints(decoyCount + 1, size + 1.5, {
      avoid: [{ pos: ringPos, size: ringSize }],
      gap: 7,
    });

    const colors = shuffle(COLORS);
    const subject = makeObject({
      shape: subjectShape,
      color: colors[0],
      pos: positions[0],
      size,
    });
    const decoys = positions.slice(1).map((pos, i) =>
      makeObject({
        shape: shapes[i + 1],
        color: colors[(i + 1) % colors.length],
        pos,
        size: randFloat(8, 10.5),
      }),
    );

    const payload: DragTargetPayload = {
      game: "drag-target",
      objects: shuffle([subject, ...decoys]),
      ring: { pos: ringPos, size: ringSize },
    };
    const secret: Secret = { correctId: subject.id };
    return {
      type: "drag-target",
      prompt: `Drag the ${SHAPE_NAME[subjectShape]} into the dashed ring`,
      payload,
      secret,
    };
  },

  validate({ payload, secret, answer, events, inputMode, tolerance }: GameValidateInput) {
    const p = payload as DragTargetPayload;
    const s = secret as unknown as Secret;
    const a = asRecord(answer);
    if (!a || a.objectId !== s.correctId) return false;
    const obj = p.objects.find((o) => o.id === s.correctId);
    if (!obj) return false;

    if (inputMode === "keyboard") {
      // Keyboard flow: piece picked up and dropped via Enter. Movement key-downs
      // carry coordinates, so we still require the journey to end at the ring.
      const keys = keyTargetSequence(events);
      if (!keys.includes(obj.id)) return false;
    } else if (countMoves(events) < 3) {
      // A pointer drag without movement is a teleport (default click/CDP
      // automation) — a genuine drag always streams many move events.
      return false;
    }
    const points = pathPoints(events);
    const start = firstIndexNear(points, obj.pos, (obj.size * 2 + 8) * tolerance);
    const end = lastIndexNear(
      points,
      p.ring.pos,
      (p.ring.size + obj.size * 0.75 + 4) * tolerance,
    );
    return start !== -1 && end !== -1 && start < end;
  },
};
