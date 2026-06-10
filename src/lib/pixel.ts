/**
 * Client-side pixel-art rasterizer for the human-check pieces.
 *
 * The server still sends each piece as a jittered vertex polygon with no shape
 * name (the anti-bot property is untouched — a script must still classify the
 * geometry). Here, purely for looks, we rasterize that polygon into a small
 * grid of square "pixels" so it renders as a crisp retro sprite with a darker
 * outline. Same geometry, prettier paint.
 */
import type { ScenePoint } from "@shared/captcha";

export interface PixelCell {
  gx: number;
  gy: number;
  edge: boolean; // on the sprite's outline → painted a shade darker
  topEdge: boolean; // nothing filled directly above → a lighter highlight (bevel)
}

/** Even-odd point-in-polygon test (unit space, ~[-1,1]). */
function inPolygon(px: number, py: number, poly: ScenePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Rasterize a unit shape to a `cells`×`cells` pixel grid. Pass `round` for the
 * circle pieces (no polygon). Edge cells (touching an empty neighbour or the
 * border) are flagged so the renderer can outline the sprite.
 */
export function pixelate(
  poly: ScenePoint[] | null | undefined,
  round: boolean | undefined,
  cells: number,
  /** Sub-cell sampling offset (±~0.5 cell). Shifting where the grid samples the
   *  SAME shape produces a different pixel pattern each time, so a bot can't hash
   *  the rendered sprite once — while the silhouette stays clean and identical. */
  offX = 0,
  offY = 0,
): PixelCell[] {
  const filled: boolean[][] = [];
  for (let gy = 0; gy < cells; gy++) {
    filled[gy] = [];
    for (let gx = 0; gx < cells; gx++) {
      const cx = -1 + ((gx + 0.5 + offX) * 2) / cells;
      const cy = -1 + ((gy + 0.5 + offY) * 2) / cells;
      filled[gy][gx] = round
        ? cx * cx + cy * cy <= 1
        : poly
          ? inPolygon(cx, cy, poly)
          : false;
    }
  }
  const out: PixelCell[] = [];
  const at = (y: number, x: number) => (y >= 0 && y < cells && x >= 0 && x < cells ? filled[y][x] : false);
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      if (!filled[gy][gx]) continue;
      const up = !at(gy - 1, gx);
      const edge = up || !at(gy + 1, gx) || !at(gy, gx - 1) || !at(gy, gx + 1);
      out.push({ gx, gy, edge, topEdge: up });
    }
  }
  return out;
}

/** Darken a #rrggbb hex by `amt` (0–1) for the sprite outline / shading. */
export function darken(hex: string, amt = 0.4): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amt));
  const g = Math.round(((n >> 8) & 255) * (1 - amt));
  const b = Math.round((n & 255) * (1 - amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Lighten a #rrggbb hex by `amt` (0–1) — used for a top-left pixel highlight. */
export function lighten(hex: string, amt = 0.3): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const up = (v: number) => Math.round(v + (255 - v) * amt);
  const r = up((n >> 16) & 255);
  const g = up((n >> 8) & 255);
  const b = up(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
