/**
 * Connect the pair — "Draw a line between the two diamonds."
 * Exactly two objects share the subject shape; the recorded stroke must travel
 * from one to the other. Keyboard users select both pieces instead of dragging.
 */
import type { ConnectPayload } from "@shared/captcha";
import { randFloat, shuffle } from "../rng";
import {
  COLORS,
  SHAPES,
  SHAPE_NAME,
  asRecord,
  countMoves,
  dist,
  firstIndexNear,
  keyTargetSequence,
  lastIndexNear,
  makeObject,
  pathPoints,
  placePoints,
} from "./helpers";
import type { GamePlugin, GameValidateInput } from "./types";

type Secret = {
  aId: string;
  bId: string;
};

const COUNT = { easy: 4, normal: 5, hard: 6 } as const;

export const connect: GamePlugin = {
  type: "connect",

  generate({ difficulty }) {
    const count = COUNT[difficulty];
    const shapes = shuffle(SHAPES);
    const subjectShape = shapes[0];
    const size = 9.5;

    // Re-roll placement until the two subject nodes are comfortably far apart,
    // so the connecting stroke is an unmistakable gesture.
    let positions = placePoints(count, size, { gap: 8 });
    for (let i = 0; i < 8 && dist(positions[0], positions[1]) < 38; i++) {
      positions = placePoints(count, size, { gap: 8 });
    }

    const colors = shuffle(COLORS);
    const objects = positions.map((pos, i) =>
      makeObject({
        // Index 0 and 1 are the pair; the rest take distinct decoy shapes.
        shape: i <= 1 ? subjectShape : shapes[i - 1],
        color: colors[i % colors.length],
        pos,
        size: randFloat(8.5, 10),
      }),
    );
    const [a, b] = objects;

    const payload: ConnectPayload = {
      game: "connect",
      objects: shuffle(objects),
    };
    const secret: Secret = { aId: a.id, bId: b.id };
    return {
      type: "connect",
      prompt: `Draw a line between the two ${SHAPE_NAME[subjectShape]}s`,
      payload,
      secret,
    };
  },

  validate({ payload, secret, answer, events, tolerance }: GameValidateInput) {
    const p = payload as ConnectPayload;
    const s = secret as unknown as Secret;
    const a = asRecord(answer);
    if (!a) return false;
    const pair = new Set([a.a, a.b]);
    if (!(pair.has(s.aId) && pair.has(s.bId) && pair.size === 2)) return false;

    const objA = p.objects.find((o) => o.id === s.aId);
    const objB = p.objects.find((o) => o.id === s.bId);
    if (!objA || !objB) return false;

    // Keyboard selection proof (both pieces activated) — accepted in any input
    // mode so a user who switches device mid-game is never punished.
    const keys = keyTargetSequence(events);
    if (keys.includes(s.aId) && keys.includes(s.bId)) return true;
    // Otherwise it's a pointer stroke, which must actually move (teleport = bot).
    if (countMoves(events) < 3) return false;
    const points = pathPoints(events);
    const rA = (objA.size * 2 + 8) * tolerance;
    const rB = (objB.size * 2 + 8) * tolerance;
    const aFirst = firstIndexNear(points, objA.pos, rA);
    const bLast = lastIndexNear(points, objB.pos, rB);
    const bFirst = firstIndexNear(points, objB.pos, rB);
    const aLast = lastIndexNear(points, objA.pos, rA);
    // A→B or B→A — either direction is a valid connection.
    return (
      (aFirst !== -1 && bLast !== -1 && aFirst < bLast) ||
      (bFirst !== -1 && aLast !== -1 && bFirst < aLast)
    );
  },
};
