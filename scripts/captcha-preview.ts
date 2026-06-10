/**
 * Visual preview of the human-check pixel-art look (run: npx tsx scripts/captcha-preview.ts).
 * Renders the pixel sprites + the slide game at the new short landscape aspect,
 * the same way the client does (server jittered polygon → client pixel grid).
 * Standalone — no worker imports — so it just shows the aesthetic.
 */
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";

const SCENE_W = 100, SCENE_H = 66, SCALE = 6, CELLS = 9;
const COLORS = ["#4f7df9", "#e0564f", "#2fa672", "#d9952c", "#8b62e9", "#d65a9c", "#2e9bb5"];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

type P = { x: number; y: number };
function jpoly(corners: number, baseRot: number, inner?: number): P[] {
  const n = inner === undefined ? corners : corners * 2;
  const v: P[] = [];
  for (let i = 0; i < n; i++) {
    const r = (inner === undefined ? 1 : i % 2 === 0 ? 1 : inner) * (1 + rnd(-0.06, 0.06));
    const a = baseRot + ((Math.PI * 2) / n) * i + rnd(-0.05, 0.05);
    v.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return v;
}
function glyph(shape: string): { poly?: P[]; round?: boolean } {
  switch (shape) {
    case "circle": return { round: true };
    case "square": return { poly: jpoly(4, Math.PI / 4 + rnd(-0.08, 0.08)) };
    case "triangle": return { poly: jpoly(3, rnd(0, 6.28)) };
    case "hexagon": return { poly: jpoly(6, rnd(0, 6.28)) };
    case "star": return { poly: jpoly(5, rnd(0, 6.28), 0.46) };
    default: return { round: true };
  }
}
function inPoly(px: number, py: number, poly: P[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function darken(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amt));
  const g = Math.round(((n >> 8) & 255) * (1 - amt));
  const b = Math.round((n & 255) * (1 - amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// deno-lint-ignore no-explicit-any
function sprite(ctx: any, ox: number, oy: number, cx: number, cy: number, size: number, shape: string, color: string) {
  const g = glyph(shape);
  const filled: boolean[][] = [];
  for (let gy = 0; gy < CELLS; gy++) {
    filled[gy] = [];
    for (let gx = 0; gx < CELLS; gx++) {
      const ux = -1 + ((gx + 0.5) * 2) / CELLS, uy = -1 + ((gy + 0.5) * 2) / CELLS;
      filled[gy][gx] = g.round ? ux * ux + uy * uy <= 1 : inPoly(ux, uy, g.poly!);
    }
  }
  const at = (y: number, x: number) => (y >= 0 && y < CELLS && x >= 0 && x < CELLS ? filled[y][x] : false);
  const px = (size * 2) / CELLS;
  for (let gy = 0; gy < CELLS; gy++)
    for (let gx = 0; gx < CELLS; gx++) {
      if (!filled[gy][gx]) continue;
      const edge = !at(gy - 1, gx) || !at(gy + 1, gx) || !at(gy, gx - 1) || !at(gy, gx + 1);
      ctx.fillStyle = edge ? darken(color, 0.45) : color;
      const x = (ox + cx - size + gx * px) * SCALE;
      const y = (oy + cy - size + gy * px) * SCALE;
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(px * SCALE) + 1, Math.ceil(px * SCALE) + 1);
    }
}

function panel(ctx: any, ox: number, oy: number, title: string, draw: () => void) {
  // card
  ctx.fillStyle = "#0f1422";
  ctx.fillRect(ox * SCALE, oy * SCALE, SCENE_W * SCALE, SCENE_H * SCALE);
  ctx.strokeStyle = "#2a3550";
  ctx.lineWidth = 2;
  ctx.strokeRect(ox * SCALE + 1, oy * SCALE + 1, SCENE_W * SCALE - 2, SCENE_H * SCALE - 2);
  draw();
  ctx.fillStyle = "#9fb0d0";
  ctx.font = "12px sans-serif";
  ctx.fillText(title, ox * SCALE + 6, (oy + SCENE_H) * SCALE + 16);
}

const COLS = 2, ROWS = 2, GAP = 10, LABEL = 22;
const W = (COLS * (SCENE_W + GAP) + GAP) * SCALE;
const H = (ROWS * (SCENE_H + GAP + LABEL / SCALE) + GAP) * SCALE + 40;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#070a12";
ctx.fillRect(0, 0, W, H);
ctx.fillStyle = "#e6ecf7";
ctx.font = "bold 16px sans-serif";
ctx.fillText("Human-check — pixel-art pieces · short landscape (100×66)", 12, 24);

const cell = (col: number, row: number) => ({
  ox: GAP + col * (SCENE_W + GAP),
  oy: 40 / SCALE + GAP + row * (SCENE_H + GAP + LABEL / SCALE),
});

// Panel 1 — tap the shape (5 pixel sprites)
{
  const { ox, oy } = cell(0, 0);
  panel(ctx, ox, oy, "Tap the star", () => {
    const shapes = ["star", "circle", "triangle", "hexagon", "square"];
    const xs = [20, 40, 60, 78, 50], ys = [22, 44, 24, 46, 12];
    shapes.forEach((s, i) => sprite(ctx, ox, oy, xs[i], ys[i], rnd(8, 10), s, pick(COLORS)));
  });
}
// Panel 2 — slide to notch
{
  const { ox, oy } = cell(1, 0);
  panel(ctx, ox, oy, "Slide the handle into the notch", () => {
    const color = pick(COLORS), ty = SCENE_H / 2, target = 70, pos = 30;
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = i % 2 ? "#39456a" : "#2a3550";
      ctx.fillRect((ox + 4 + i * 3.84) * SCALE, (oy + ty - 3) * SCALE, 3.2 * SCALE, 6 * SCALE);
    }
    ctx.strokeStyle = darken(color, 0.2);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect((ox + target - 5) * SCALE, (oy + ty - 9) * SCALE, 10 * SCALE, 18 * SCALE);
    ctx.setLineDash([]);
    ctx.fillStyle = darken(color, 0.5);
    ctx.fillRect((ox + pos - 4.5) * SCALE, (oy + ty - 9) * SCALE, 9 * SCALE, 18 * SCALE);
    ctx.fillStyle = color;
    ctx.fillRect((ox + pos - 3.5) * SCALE, (oy + ty - 8) * SCALE, 7 * SCALE, 16 * SCALE);
  });
}
// Panel 3 — drag into ring
{
  const { ox, oy } = cell(0, 1);
  panel(ctx, ox, oy, "Drag the star into the ring", () => {
    ctx.strokeStyle = "#5a6b95";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc((ox + 74) * SCALE, (oy + 40) * SCALE, 13 * SCALE, 0, 6.3);
    ctx.stroke();
    ctx.setLineDash([]);
    sprite(ctx, ox, oy, 24, 30, 10, "star", COLORS[0]);
    sprite(ctx, ox, oy, 50, 18, 9, "hexagon", COLORS[2]);
    sprite(ctx, ox, oy, 44, 50, 9, "triangle", COLORS[3]);
  });
}
// Panel 4 — trace the dots
{
  const { ox, oy } = cell(1, 1);
  panel(ctx, ox, oy, "Drag through the dots in order", () => {
    const color = COLORS[6];
    const pts = [{ x: 22, y: 44, n: 1 }, { x: 48, y: 20, n: 2 }, { x: 74, y: 46, n: 3 }];
    ctx.strokeStyle = "#3a466a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo((ox + p.x) * SCALE, (oy + p.y) * SCALE) : ctx.moveTo((ox + p.x) * SCALE, (oy + p.y) * SCALE)));
    ctx.stroke();
    pts.forEach((p) => {
      sprite(ctx, ox, oy, p.x, p.y, 7, "circle", color);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(String(p.n), (ox + p.x) * SCALE - 4, (oy + p.y) * SCALE + 5);
    });
  });
}

const out = "scripts/captcha-preview.png";
writeFileSync(out, canvas.toBuffer("image/png"));
console.log("wrote", out, `${W}x${H}`);
