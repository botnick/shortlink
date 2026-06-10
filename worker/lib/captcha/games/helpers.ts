import type {
  CaptchaEvent,
  SceneObject,
  ScenePoint,
  ShapeKind,
} from "@shared/captcha";
import { SCENE_H, SCENE_W } from "@shared/captcha";
import { randFloat, sceneId, shuffle } from "../rng";

export const SHAPES: readonly ShapeKind[] = [
  "circle",
  "square",
  "triangle",
  "hexagon",
  "star",
  "heart",
  "diamond",
  "plus",
];

export const SHAPE_NAME: Record<ShapeKind, string> = {
  circle: "circle",
  square: "square",
  triangle: "triangle",
  hexagon: "hexagon",
  star: "star",
  heart: "heart",
  diamond: "diamond",
  plus: "plus",
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Build a piece's outline as unit-space vertices with per-challenge jitter.
 * Generating the geometry HERE (server-side) and shipping only the vertices —
 * never the shape's name — is what forces a script to visually classify the
 * outline instead of reading `obj.shape`. The radius/angle jitter changes the
 * exact vertex list every time, so "this path == a star" can't be precomputed.
 */
function jitteredPolygon(
  corners: number,
  baseRot: number,
  inner?: number,
): ScenePoint[] {
  const count = inner === undefined ? corners : corners * 2;
  const verts: ScenePoint[] = [];
  // Moderate jitter: enough that no two challenges share an exact vertex list
  // (so the polygon can't be hashed/precomputed) while the silhouette stays
  // clean and instantly readable — not a melted blob.
  for (let i = 0; i < count; i++) {
    const r = (inner === undefined ? 1 : i % 2 === 0 ? 1 : inner) *
      (1 + randFloat(-0.05, 0.05));
    const a = baseRot + ((Math.PI * 2) / count) * i + randFloat(-0.04, 0.04);
    verts.push({ x: round2(Math.cos(a) * r), y: round2(Math.sin(a) * r) });
  }
  return verts;
}

/** A free spin for shapes whose identity survives any rotation. */
function freeRot(): number {
  return randFloat(0, Math.PI * 2);
}

/** A k·90° turn (+ a hair of jitter) for shapes with 4-fold symmetry: the
 *  vertex list differs every time (defeats polygon-hash) while the silhouette
 *  is identical — a square stays a square, a plus stays a plus. */
function quarterTurn(base: number): number {
  return base + Math.floor(randFloat(0, 4)) * (Math.PI / 2) + randFloat(-0.05, 0.05);
}

/** Light per-vertex jitter for the fixed-orientation shapes (heart/plus), so no
 *  two challenges share an exact outline while the silhouette stays clean. */
function jitter(verts: ScenePoint[]): ScenePoint[] {
  return verts.map((v) => ({
    x: round2(v.x * (1 + randFloat(-0.03, 0.03))),
    y: round2(v.y * (1 + randFloat(-0.03, 0.03))),
  }));
}

/** Heart outline sampled from the classic heart curve, normalized to ~[-1,1]. */
function heartVerts(): ScenePoint[] {
  const n = 18;
  const raw: ScenePoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push({ x, y: -y }); // flip to SVG y-down (point at the bottom)
  }
  let m = 0;
  for (const p of raw) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  return raw.map((p) => ({ x: round2((p.x / m) * 0.98), y: round2((p.y / m) * 0.98) }));
}

/** A plus / cross outline (12 vertices). */
function plusVerts(): ScenePoint[] {
  const a = 0.36, b = 1;
  return [
    { x: -a, y: -b }, { x: a, y: -b }, { x: a, y: -a }, { x: b, y: -a },
    { x: b, y: a }, { x: a, y: a }, { x: a, y: b }, { x: -a, y: b },
    { x: -a, y: a }, { x: -b, y: a }, { x: -b, y: -a }, { x: -a, y: -a },
  ];
}

function glyphFor(shape: ShapeKind): { poly?: ScenePoint[]; round?: boolean } {
  switch (shape) {
    case "circle":
      return { round: true };
    // Square's corners sit at 45° (flat top/bottom sides). The k·90° turn keeps
    // them off-axis (still a square, never a diamond) while varying the vertices.
    case "square":
      return { poly: jitteredPolygon(4, quarterTurn(Math.PI / 4)) };
    // Diamond's corners sit ON the axes (point up). The k·90° turn keeps them
    // on-axis (still a diamond, never a square).
    case "diamond":
      return { poly: jitteredPolygon(4, quarterTurn(0)) };
    case "triangle":
      return { poly: jitteredPolygon(3, freeRot()) };
    case "hexagon":
      return { poly: jitteredPolygon(6, freeRot()) };
    case "star":
      return { poly: jitteredPolygon(5, freeRot(), 0.46) };
    // Heart can't rotate (it'd stop reading as a heart) — vary it with a random
    // horizontal flip + light jitter instead.
    case "heart": {
      const v = jitter(heartVerts());
      return { poly: randFloat(0, 1) < 0.5 ? v.map((p) => ({ x: round2(-p.x), y: p.y })) : v };
    }
    // Plus has 4-fold symmetry → a k·90° turn changes the vertex list but looks
    // identical.
    case "plus": {
      const turns = Math.floor(randFloat(0, 4));
      let v = jitter(plusVerts());
      for (let t = 0; t < turns; t++) v = v.map((p) => ({ x: round2(-p.y), y: round2(p.x) }));
      return { poly: v };
    }
  }
}

/** Piece palette. Colors are decoration only — every rule discriminates by
 *  SHAPE (never color alone), so color-blind users are never disadvantaged. */
export const COLORS = [
  "#4f7df9",
  "#e0564f",
  "#2fa672",
  "#d9952c",
  "#8b62e9",
  "#d65a9c",
  "#2e9bb5",
];

export function dist(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Smallest absolute angular difference in degrees (0–180). */
export function angDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export interface AvoidZone {
  pos: ScenePoint;
  size: number;
}

/**
 * Random non-overlapping positions inside the scene. Rejection sampling with a
 * deterministic jittered-grid fallback so generation can never spin forever.
 */
export function placePoints(
  count: number,
  size: number,
  opts: { margin?: number; gap?: number; avoid?: AvoidZone[] } = {},
): ScenePoint[] {
  const margin = opts.margin ?? size + 6;
  const gap = opts.gap ?? 6;
  const avoid = opts.avoid ?? [];
  const placed: ScenePoint[] = [];
  const ok = (p: ScenePoint) =>
    placed.every((q) => dist(p, q) >= size * 2 + gap) &&
    avoid.every((z) => dist(p, z.pos) >= size + z.size + gap);

  const my = Math.min(margin, SCENE_H / 2 - 2); // vertical margin can't exceed half-height
  for (let i = 0; i < count; i++) {
    let found = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = {
        x: randFloat(margin, SCENE_W - margin),
        y: randFloat(my, SCENE_H - my),
      };
      if (ok(p)) {
        placed.push(p);
        found = true;
        break;
      }
    }
    if (!found) {
      // Fallback: scan a shuffled 4×3 grid of jittered cells (fits the short
      // landscape) for a free spot.
      const rowH = (SCENE_H - 18) / 2;
      const cells = shuffle(
        Array.from({ length: 12 }, (_, n) => ({
          x: 14 + (n % 4) * 24 + randFloat(-4, 4),
          y: 10 + Math.floor(n / 4) * rowH + randFloat(-3, 3),
        })),
      );
      placed.push(cells.find(ok) ?? cells[0]);
    }
  }
  return placed;
}

export interface GlyphInput {
  shape: ShapeKind;
  color: string;
  pos: ScenePoint;
  size: number;
  label?: string;
}

/** Create a renderable scene object from an internal shape. The shape NAME is
 *  consumed here to build the vertex outline and is deliberately not carried
 *  onto the wire object. */
export function makeObject(input: GlyphInput): SceneObject {
  const glyph = glyphFor(input.shape);
  return {
    id: sceneId(),
    poly: glyph.poly,
    round: glyph.round,
    color: input.color,
    pos: input.pos,
    size: input.size,
    phase: randFloat(0, Math.PI * 2),
    ...(input.label !== undefined ? { label: input.label } : {}),
  };
}

// --- Answer parsing -------------------------------------------------------------

export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function asStringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === "string")
    ? (v as string[])
    : null;
}

// --- Interaction-evidence geometry ------------------------------------------------
// Keyboard accessibility: the recorder emits key-down events that carry the id
// of the element acted on and (for movement) the piece's resulting coordinates,
// so every geometric check below works for keyboard users too.

export interface PathPoint {
  x: number;
  y: number;
  i: number; // index in the original event list (preserves ordering)
}

/** All positioned events, in order. */
export function pathPoints(events: CaptchaEvent[]): PathPoint[] {
  const out: PathPoint[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (typeof e.x === "number" && typeof e.y === "number") {
      out.push({ x: e.x, y: e.y, i });
    }
  }
  return out;
}

export function firstIndexNear(
  points: PathPoint[],
  pos: ScenePoint,
  r: number,
): number {
  for (const p of points) if (dist(p, pos) <= r) return p.i;
  return -1;
}

export function lastIndexNear(
  points: PathPoint[],
  pos: ScenePoint,
  r: number,
): number {
  for (let k = points.length - 1; k >= 0; k--) {
    if (dist(points[k], pos) <= r) return points[k].i;
  }
  return -1;
}

/**
 * First event that counts as "tapping" an object: a pointer-down near it, or a
 * key-down targeting it (keyboard users activate via Enter/Space). Returns the
 * event index, or -1.
 */
export function tapIndexFor(
  events: CaptchaEvent[],
  obj: { id: string; pos: ScenePoint; size: number },
  r: number,
): number {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.t === "key-down" && e.targetId === obj.id) return i;
    // Require the actual press (pointer-down), not just a release — a real tap
    // always begins with a down on the target. A bot that only fabricates the
    // answer object id with no matching press fails here.
    if (
      e.t === "pointer-down" &&
      typeof e.x === "number" &&
      typeof e.y === "number" &&
      dist({ x: e.x, y: e.y }, obj.pos) <= r
    ) {
      return i;
    }
  }
  return -1;
}

/** Does the recorded path pass within `r(w)` of each waypoint, in order? */
export function passesInOrder(
  points: PathPoint[],
  waypoints: { pos: ScenePoint; size: number }[],
  rFor: (w: { pos: ScenePoint; size: number }) => number,
): boolean {
  let k = 0;
  for (const w of waypoints) {
    const r = rFor(w);
    let hit = false;
    while (k < points.length) {
      if (dist(points[k], w.pos) <= r) {
        hit = true;
        break;
      }
      k++;
    }
    if (!hit) return false;
  }
  return true;
}

/** Count of pointer-move events — a real drag/trace emits many (the recorder
 *  throttles to ~40Hz); default automation teleports with ~0. */
export function countMoves(events: CaptchaEvent[]): number {
  let n = 0;
  for (const e of events) if (e.t === "pointer-move") n++;
  return n;
}

/** Key-down target ids, in order (for keyboard alternates of path-style games). */
export function keyTargetSequence(events: CaptchaEvent[]): string[] {
  return events
    .filter((e) => e.t === "key-down" && typeof e.targetId === "string")
    .map((e) => e.targetId as string);
}

/** Is `needle` an in-order subsequence of `haystack`? */
export function isSubsequence(needle: string[], haystack: string[]): boolean {
  let i = 0;
  for (const h of haystack) {
    if (h === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}
