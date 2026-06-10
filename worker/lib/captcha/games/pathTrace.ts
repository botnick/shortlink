/**
 * Path trace — "Drag through the dots in order."
 * Numbered dots laid out as a short random walk; one continuous stroke must
 * pass each in sequence. The answer is inherently an interaction, which is the
 * strongest screenshot resistance in the pool: a still image can't replay it.
 * Keyboard users activate the dots in order instead of dragging.
 */
import type { PathTracePayload } from "@shared/captcha";
import { SCENE_H, SCENE_W } from "@shared/captcha";
import { pick, randFloat, shuffle } from "../rng";
import {
  COLORS,
  asRecord,
  asStringArray,
  countMoves,
  isSubsequence,
  keyTargetSequence,
  makeObject,
  passesInOrder,
  pathPoints,
} from "./helpers";
import type { GamePlugin, GameValidateInput } from "./types";

type Secret = {
  order: string[];
};

const DOTS = { easy: 3, normal: 4, hard: 4 } as const;

export const pathTrace: GamePlugin = {
  type: "path-trace",

  generate({ difficulty }) {
    const count = DOTS[difficulty];
    const size = 7;
    const color = pick(COLORS);

    // Random walk: each dot a short hop from the previous, clamped to the short
    // landscape bounds and re-rolled when it would crowd an earlier dot.
    const loY = 10, hiY = SCENE_H - 10, loX = 14, hiX = SCENE_W - 14;
    const pts: { x: number; y: number }[] = [
      { x: randFloat(loX, 42), y: randFloat(loY, hiY) },
    ];
    while (pts.length < count) {
      const prev = pts[pts.length - 1];
      let next = { x: 0, y: 0 };
      let ok = false;
      for (let attempt = 0; attempt < 40 && !ok; attempt++) {
        const ang = randFloat(0, Math.PI * 2);
        const d = randFloat(22, 34);
        next = {
          x: Math.min(hiX, Math.max(loX, prev.x + Math.cos(ang) * d)),
          y: Math.min(hiY, Math.max(loY, prev.y + Math.sin(ang) * d)),
        };
        ok = pts.every((q) => Math.hypot(q.x - next.x, q.y - next.y) > size * 2 + 8);
      }
      pts.push(ok ? next : { x: SCENE_W - prev.x, y: SCENE_H - prev.y });
    }

    const dots = pts.map((pos, i) =>
      makeObject({ shape: "circle", color, pos, size, label: String(i + 1) }),
    );

    const payload: PathTracePayload = {
      game: "path-trace",
      dots: shuffle(dots),
    };
    const secret: Secret = { order: dots.map((d) => d.id) };
    return {
      type: "path-trace",
      prompt: "Drag through the dots in order",
      payload,
      secret,
    };
  },

  validate({ payload, secret, answer, events, tolerance }: GameValidateInput) {
    const p = payload as PathTracePayload;
    const s = secret as unknown as Secret;
    const a = asRecord(answer);
    const order = a ? asStringArray(a.order) : null;
    if (!order || order.length !== s.order.length) return false;
    if (!order.every((id, i) => id === s.order[i])) return false;

    // Keyboard alternate (dots activated in order) — accepted in any input
    // mode so mixed-device users are never punished.
    if (isSubsequence(s.order, keyTargetSequence(events))) return true;
    // A real trace streams move events across the dots; a teleport doesn't.
    if (countMoves(events) < 4) return false;
    const waypoints = s.order.map((id) => p.dots.find((d) => d.id === id));
    if (waypoints.some((w) => !w)) return false;
    return passesInOrder(
      pathPoints(events),
      waypoints as { pos: { x: number; y: number }; size: number }[],
      (w) => (w.size * 2.4 + 6) * tolerance,
    );
  },
};
