/**
 * Preview the 6 pixel-art backdrop themes with a procedural game piece on top
 * (run: npx tsx scripts/themes-preview.ts). Standalone reimplementation of the
 * theme draws + a pixel sprite, just to SEE the variety. The real ones live in
 * src/components/captcha/themes.tsx.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";

const W = 100, H = 66, S = 6;
const mul = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const R = (c: SKRSContext2D, x: number, y: number, w: number, h: number, col: string, a = 1) => {
  c.globalAlpha = a; c.fillStyle = col; c.fillRect(x * S, y * S, w * S, h * S); c.globalAlpha = 1;
};
const C = (c: SKRSContext2D, x: number, y: number, rad: number, col: string, a = 1) => {
  c.globalAlpha = a; c.fillStyle = col; c.beginPath(); c.arc(x * S, y * S, rad * S, 0, 6.3); c.fill(); c.globalAlpha = 1;
};

function grad(c: SKRSContext2D, top: string, bot: string) {
  const g = c.createLinearGradient(0, 0, 0, H * S);
  g.addColorStop(0, top); g.addColorStop(1, bot);
  c.fillStyle = g; c.fillRect(0, 0, W * S, H * S);
}

const THEMES: Record<string, (c: SKRSContext2D, r: () => number) => void> = {
  cyber(c, r) {
    grad(c, "#160a2e", "#0a0e1c");
    for (let i = 0; i < 10; i++) { const h = 12 + r() * 30, x = i * 10 + r() * 2; R(c, x, H - h, 7 + r() * 4, h, "#121a30");
      for (let k = 0; k < h / 4; k++) if (r() > 0.55) R(c, x + 1 + (r() > 0.5 ? 2.5 : 0), H - h + 2 + k * 4, 1.6, 1.6, ["#ff3da6", "#36e0ff", "#a06bff", "#ffd23d"][Math.floor(r() * 4)], 0.9); }
    for (let i = 0; i < 5; i++) R(c, 5 + r() * 84, 6 + r() * 26, 2 + r() * 6, 1.4, ["#ff3da6", "#36e0ff", "#a06bff"][Math.floor(r() * 3)], 0.85);
  },
  space(c, r) {
    R(c, 0, 0, W, H, "#05060f");
    for (let i = 0; i < 46; i++) { const s = r() > 0.85 ? 1.4 : 0.8; R(c, r() * W, r() * H, s, s, "#cdd6f4", 0.4 + r() * 0.6); }
    C(c, 78, 50, 16, "#2a3a6e"); C(c, 74, 46, 10, "#5a74c8", 0.5);
    c.strokeStyle = "#8aa0e8"; c.globalAlpha = 0.5; c.lineWidth = 0.8 * S; c.beginPath(); c.ellipse(78 * S, 50 * S, 24 * S, 5 * S, 0, 0, 6.3); c.stroke(); c.globalAlpha = 1;
  },
  synth(c) {
    grad(c, "#2a0e44", "#0b0418");
    C(c, 50, 26, 15, "#ff7db0"); for (let i = 0; i < 5; i++) R(c, 34, 20 + i * 3.2, 32, 1.4, "#1a0b2e");
    c.strokeStyle = "#ff4d9d"; c.lineWidth = 0.5 * S; c.globalAlpha = 0.5;
    for (let i = 0; i < 8; i++) { c.beginPath(); c.moveTo(50 * S, 40 * S); c.lineTo(i * 14.3 * S, H * S); c.stroke(); }
    c.strokeStyle = "#36e0ff"; for (let i = 0; i < 6; i++) { const y = 40 + i * i * 0.9 + i * 2; c.beginPath(); c.moveTo(0, y * S); c.lineTo(W * S, y * S); c.stroke(); } c.globalAlpha = 1;
  },
  forest(c, r) {
    grad(c, "#0c2438", "#07140e"); C(c, 20, 16, 6, "#e7eccd", 0.9);
    for (let i = 0; i < 9; i++) { const x = i * 11 + r() * 3, th = 18 + r() * 16;
      for (let k = 0; k < 3; k++) { const top = H - th + k * th * 0.28, by = top + th * 0.4; c.fillStyle = k === 0 ? "#15402a" : "#0f3320"; c.beginPath(); c.moveTo(x * S, top * S); c.lineTo((x - 6 + k) * S, by * S); c.lineTo((x + 6 - k) * S, by * S); c.fill(); } }
    for (let i = 0; i < 7; i++) R(c, r() * W, 20 + r() * 30, 1.2, 1.2, "#ffe27a", 0.8);
  },
  dungeon(c, r) {
    R(c, 0, 0, W, H, "#120f0c");
    for (let row = 0; row < 6; row++) for (let col = 0; col < 9; col++) { c.fillStyle = `#${(24 + Math.floor(r() * 8)).toString(16)}1a12`; c.strokeStyle = "#0a0806"; c.lineWidth = 0.5 * S; const x = (col * 11.5 + (row % 2 ? 5 : 0)) * S, y = row * 11 * S; c.fillRect(x, y, 10.5 * S, 10 * S); c.strokeRect(x, y, 10.5 * S, 10 * S); }
    for (const x of [24, 76]) { C(c, x, 22, 12, "#ff8a2a", 0.12); C(c, x, 22, 6, "#ffb24a", 0.18); R(c, x - 1.5, 17, 3, 3, "#ffd152"); }
  },
  ocean(c, r) {
    grad(c, "#0a3554", "#04121f");
    c.strokeStyle = "#7fd0ff"; c.lineWidth = 0.5 * S; c.globalAlpha = 0.4;
    for (let i = 0; i < 16; i++) { c.beginPath(); c.arc(r() * W * S, r() * H * S, (0.8 + r() * 2.2) * S, 0, 6.3); c.stroke(); } c.globalAlpha = 1;
    R(c, 0, H - 4, W, 4, "#0a2238");
  },
  sunset(c) {
    const g = c.createLinearGradient(0, 0, 0, H * S); g.addColorStop(0, "#ff8c5a"); g.addColorStop(0.5, "#b04a7e"); g.addColorStop(1, "#2a1430"); c.fillStyle = g; c.fillRect(0, 0, W * S, H * S);
    C(c, 50, 30, 13, "#ffd36b", 0.92);
    for (let k = 0; k < 3; k++) { c.fillStyle = k % 2 ? "#3a1f3e" : "#52223f"; c.beginPath(); c.ellipse((18 + k * 30) * S, (H + 6 - k * 2) * S, 42 * S, (15 + k * 2) * S, 0, 0, 6.3); c.fill(); }
  },
  desert(c) {
    const g = c.createLinearGradient(0, 0, 0, H * S); g.addColorStop(0, "#8fc0d8"); g.addColorStop(1, "#e8c48a"); c.fillStyle = g; c.fillRect(0, 0, W * S, H * S);
    C(c, 72, 18, 10, "#ffe7a0", 0.85);
    for (let k = 0; k < 2; k++) { c.fillStyle = k ? "#7a5a2e" : "#6a4e28"; c.beginPath(); c.ellipse((30 + k * 45) * S, (H + 6) * S, 48 * S, 18 * S, 0, 0, 6.3); c.fill(); }
    for (const x of [20, 82]) { R(c, x, H - 15, 2.6, 15, "#2f5a35"); R(c, x - 3, H - 11, 3, 2.6, "#2f5a35"); R(c, x + 2.6, H - 9, 3, 2.6, "#2f5a35"); }
  },
  lava(c, r) {
    R(c, 0, 0, W, H, "#190707");
    for (let i = 0; i < 26; i++) R(c, r() * W, r() * (H - 10), 1 + r(), 1 + r(), r() > 0.5 ? "#ff7a2a" : "#ff3b1a", 0.6);
    R(c, 0, H - 7, W, 7, "#4a0f0f");
    for (let i = 0; i < 12; i++) R(c, i * 8.6, H - 7, 3 + r() * 2, 7, "#ff5a1a", 0.55);
    R(c, 0, H - 7, W, 1.4, "#ffd23d", 0.7);
  },
  gameboy(c, r) {
    R(c, 0, 0, W, H, "#0f380f"); const pal = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];
    for (let row = 0; row < 7; row++) for (let col = 0; col < 12; col++) if (r() > 0.72) R(c, col * 8.5, row * 9.6, 8, 9, pal[1 + Math.floor(r() * 3)], 0.4);
  },
  aurora(c, r) {
    R(c, 0, 0, W, H, "#04101e");
    for (let i = 0; i < 28; i++) R(c, r() * W, r() * 30, 0.9, 0.9, "#dbe4ff", 0.7);
    ["#3affa0", "#7a5cff", "#36e0ff"].forEach((col, i) => R(c, 0, 5 + i * 6, W, 4, col, 0.13));
    for (let k = 0; k < 4; k++) { c.fillStyle = k % 2 ? "#0e2236" : "#13304a"; c.beginPath(); c.moveTo(k * 30 * S, H * S); c.lineTo((k * 30 + 18) * S, (H - 22 - (k % 2) * 8) * S); c.lineTo((k * 30 + 36) * S, H * S); c.fill(); }
  },
};

const shade = (hex: string, amt: number, up = false) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => (up ? Math.round(v + (255 - v) * amt) : Math.round(v * (1 - amt)));
  return `#${((f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, "0")}`;
};

// shape vertex generators (unit space) — mirrors the worker glyphFor
const reg = (corners: number, rot: number, inner?: number): [number, number][] => {
  const n = inner === undefined ? corners : corners * 2, v: [number, number][] = [];
  for (let i = 0; i < n; i++) { const rr = inner === undefined ? 1 : i % 2 === 0 ? 1 : inner; const a = rot + ((Math.PI * 2) / n) * i; v.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  return v;
};
function heartV(): [number, number][] {
  const raw: [number, number][] = [];
  for (let i = 0; i < 18; i++) { const t = (i / 18) * Math.PI * 2; raw.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); }
  let m = 0; for (const [x, y] of raw) m = Math.max(m, Math.abs(x), Math.abs(y));
  return raw.map(([x, y]) => [(x / m) * 0.98, (y / m) * 0.98]);
}
const plusV = (): [number, number][] => { const a = 0.36, b = 1; return [[-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a], [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]]; };
function shapeVerts(name: string): [number, number][] | null {
  switch (name) {
    case "circle": return null;
    case "square": return reg(4, Math.PI / 4);
    case "diamond": return reg(4, 0);
    case "triangle": return reg(3, -Math.PI / 2);
    case "hexagon": return reg(6, 0);
    case "star": return reg(5, -Math.PI / 2, 0.46);
    case "heart": return heartV();
    default: return plusV();
  }
}

// clean pixel sprite (cells 13 + bevel) recolored to the theme
function sprite(c: SKRSContext2D, ox: number, cx: number, cy: number, size: number, name: string, color: string) {
  const cells = 13, verts = shapeVerts(name);
  const inP = (px: number, py: number) => {
    if (!verts) return px * px + py * py <= 1;
    let o = false; for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) { const [xi, yi] = verts[i], [xj, yj] = verts[j]; if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) o = !o; } return o;
  };
  const grid: boolean[][] = [];
  for (let gy = 0; gy < cells; gy++) { grid[gy] = []; for (let gx = 0; gx < cells; gx++) { const ux = -1 + ((gx + 0.5) * 2) / cells, uy = -1 + ((gy + 0.5) * 2) / cells; grid[gy][gx] = inP(ux, uy); } }
  const at = (y: number, x: number) => y >= 0 && y < cells && x >= 0 && x < cells && grid[y][x];
  const p = (size * 2) / cells;
  for (let gy = 0; gy < cells; gy++) for (let gx = 0; gx < cells; gx++) {
    if (!grid[gy][gx]) continue;
    const up = !at(gy - 1, gx);
    const edge = up || !at(gy + 1, gx) || !at(gy, gx - 1) || !at(gy, gx + 1);
    c.fillStyle = up ? shade(color, 0.34, true) : edge ? shade(color, 0.45) : color;
    c.fillRect((ox + cx - size + gx * p) * S, (cy - size + gy * p) * S, p * S + 1, p * S + 1);
  }
}

const names = Object.keys(THEMES);
const COLS = 4, GAP = 8;
const ROWS = Math.ceil(names.length / COLS);
const cw = W + GAP, ch = H + GAP + 4;
const cv = createCanvas((COLS * cw + GAP) * S, (ROWS * ch + GAP) * S + 30);
const ctx = cv.getContext("2d");
ctx.fillStyle = "#070a12"; ctx.fillRect(0, 0, cv.width, cv.height);
ctx.fillStyle = "#e6ecf7"; ctx.font = "bold 16px sans-serif";
ctx.fillText("Human-check — 6 pixel-art themes (random per challenge) · game piece stays procedural", 12, 22);
names.forEach((name, idx) => {
  const col = idx % COLS, row = Math.floor(idx / COLS);
  const ox = GAP + col * cw, oy = 30 / S + GAP + row * ch;
  ctx.save(); ctx.translate(ox * S, oy * S);
  THEMES[name](ctx, mul(idx * 99 + 7));
  // vignette + a recolored piece (different shape per theme)
  R(ctx, 0, 0, W, H, "#000", 0.18);
  const PALETTES = [
    ["#ff3da6", "#36e0ff", "#ffd23d", "#a06bff"], ["#7fd0ff", "#ffd23d", "#ff6f91", "#b88cff"],
    ["#ff4d9d", "#36e0ff", "#ffd76b", "#b06bff"], ["#ffe27a", "#9ad06b", "#ff9f6b", "#7fd0ff"],
    ["#ffb24a", "#ffd152", "#e0703a", "#d8b878"], ["#7fd0ff", "#9fe3ff", "#ffd23d", "#5affd0"],
    ["#ffd36b", "#ff8c5a", "#ff6f91", "#ffe27a"], ["#ffd76b", "#ff9f6b", "#6abf7a", "#f0d9a8"],
    ["#ff7a2a", "#ffd23d", "#ff5a4a", "#ffae5a"], ["#9bbc0f", "#cfe85a", "#8bac0f", "#bcd647"],
    ["#3affa0", "#7a5cff", "#36e0ff", "#dbe4ff"],
  ];
  const SH = ["star", "heart", "diamond", "plus", "hexagon", "triangle", "square", "circle", "heart", "star", "diamond"];
  const pal = PALETTES[idx % PALETTES.length];
  sprite(ctx, 0, 38, 33, 11, SH[idx % SH.length], pal[0]);
  sprite(ctx, 0, 64, 33, 8, SH[(idx + 3) % SH.length], pal[1]);
  ctx.restore();
  ctx.fillStyle = "#9fb0d0"; ctx.font = "12px sans-serif"; ctx.fillText(name, ox * S + 4, (oy + H) * S + 14);
});

writeFileSync("scripts/themes-preview.png", cv.toBuffer("image/png"));
console.log("wrote scripts/themes-preview.png", `${cv.width}x${cv.height}`);
