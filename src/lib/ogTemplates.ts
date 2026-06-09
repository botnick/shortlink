// Client-side OG-image generation — draws a 1200×630 social card on a <canvas>,
// so there's zero Worker CPU/cost. A library of distinct, restrained layouts
// (no two share a silhouette); each uses the chosen font + brand colour.
import { DEFAULT_APP_NAME, DEFAULT_BRAND_COLOR } from "@shared/defaults";

export const OG_W = 1200;
export const OG_H = 630;

export const OG_TEMPLATES: { id: string; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "dark", label: "Dark" },
  { id: "brand", label: "Brand" },
  { id: "split", label: "Split" },
  { id: "grid", label: "Grid" },
  { id: "editorial", label: "Editorial" },
  { id: "glow", label: "Glow" },
  { id: "sidebar", label: "Sidebar" },
  { id: "footer", label: "Footer" },
  { id: "frame", label: "Frame" },
  { id: "card", label: "Link preview" },
  { id: "mono", label: "Mono" },
];

export interface OgOptions {
  template: string;
  /** Canvas font-family, already loaded via `loadOgFont` (see ogFonts.ts). */
  font: string;
  title: string;
  description?: string;
  appName: string;
  brandColor: string;
  url?: string;
  /** Optional brand logo drawn in the lockup (already loaded + same-origin/CORS-safe). */
  logo?: HTMLImageElement | null;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : parseInt(DEFAULT_BRAND_COLOR.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbStr([r, g, b]: Rgb): string {
  return `rgb(${r},${g},${b})`;
}
function withA([r, g, b]: Rgb, a: number): string {
  return `rgba(${r},${g},${b},${a})`;
}
/** Lighten (f>0) or darken (f<0) toward white/black. */
function shade([r, g, b]: Rgb, f: number): Rgb {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return [c(r), c(g), c(b)];
}
function luminance([r, g, b]: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
/** Brand colour nudged to stay legible on a near-white or near-black ground. */
function inkOnLight(rgb: Rgb): string {
  return luminance(rgb) > 0.72 ? rgbStr(shade(rgb, -0.42)) : rgbStr(rgb);
}
function inkOnDark(rgb: Rgb): string {
  return luminance(rgb) < 0.22 ? rgbStr(shade(rgb, 0.55)) : rgbStr(rgb);
}
function onBrand(rgb: Rgb): string {
  return luminance(rgb) > 0.62 ? "#18181b" : "#ffffff";
}

const INK = { t: "#18181b", sub: "#52525b", mut: "#a1a1aa", line: "#e7e7ea" };
const DK = { bg: "#09090b", t: "#fafafa", sub: "#a1a1aa", mut: "#71717a", line: "#272729" };

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Rounded on the right edge only (square left) — for a panel flush against a card.
function roundRightRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

// Break opportunities. Intl.Segmenter('th') uses ICU's Thai dictionary, so Thai
// (which has no inter-word spaces) breaks between words instead of mid-syllable;
// Latin falls back to spaces. Accessed defensively so it degrades without the API.
function breakUnits(text: string): string[] {
  const Seg = (
    Intl as unknown as {
      Segmenter?: new (
        l?: string,
        o?: { granularity: string },
      ) => { segment(s: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  if (Seg) {
    return Array.from(
      new Seg(undefined, { granularity: "word" }).segment(text),
      (s) => s.segment,
    );
  }
  return text.split(/(\s+)/).filter(Boolean);
}

// Fit text to width by greedily filling lines at word boundaries, hard-breaking
// any single unit that's still too wide (very long URL, no break opportunity).
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  const hardChars = (chunk: string) => {
    for (const ch of Array.from(chunk)) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
  };
  for (const unit of breakUnits(text)) {
    if (line && ctx.measureText(line + unit).width > maxW) {
      lines.push(line.replace(/\s+$/, ""));
      line = "";
      if (ctx.measureText(unit).width > maxW) {
        hardChars(unit);
      } else if (unit.trim()) {
        line = unit;
      }
    } else {
      line += unit;
    }
  }
  if (line.trim()) lines.push(line.replace(/\s+$/, ""));
  return lines;
}
function clampLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const all = wrapLines(ctx, text.trim(), maxW);
  if (all.length <= maxLines) return all;
  const kept = all.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.replace(/\s+$/, "")}…`;
  return kept;
}

interface Fit {
  lines: string[];
  size: number;
  lh: number;
}
/** Largest weight-700 size (maxSize→minSize) whose wrap fits `maxLines`. */
function fitTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  fam: string,
  maxW: number,
  maxLines: number,
  maxSize: number,
  minSize: number,
): Fit {
  for (let size = maxSize; size > minSize; size -= 3) {
    ctx.font = `700 ${size}px ${fam}`;
    if (wrapLines(ctx, text.trim(), maxW).length <= maxLines) {
      return { lines: wrapLines(ctx, text.trim(), maxW), size, lh: size * 1.14 };
    }
  }
  ctx.font = `700 ${minSize}px ${fam}`;
  return { lines: clampLines(ctx, text, maxW, maxLines), size: minSize, lh: minSize * 1.14 };
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lh: number,
): number {
  ctx.textBaseline = "top";
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += lh;
  }
  return y;
}

export function renderOg(canvas: HTMLCanvasElement, o: OgOptions) {
  canvas.width = OG_W;
  canvas.height = OG_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const rgb = hexToRgb(o.brandColor);
  const brand = rgbStr(rgb);
  const fam = `"${o.font || "IBM Plex Sans Thai"}", "IBM Plex Sans Thai", system-ui, sans-serif`;
  const face = (w: number, s: number) => `${w} ${s}px ${fam}`;
  const title = o.title.trim() || o.appName.trim() || DEFAULT_APP_NAME;
  const desc = (o.description ?? "").trim();
  const app = (o.appName || DEFAULT_APP_NAME).trim();
  const url = (o.url ?? "").trim();
  const domain = url.split("/")[0] || "";

  ctx.clearRect(0, 0, OG_W, OG_H);
  ctx.textAlign = "left";

  // Small reusable brand lockup: brand logo (if loaded) or accent bar + app name.
  const lockup = (x: number, y: number, accent: string, text: string) => {
    let markEnd = x + 25;
    if (o.logo && o.logo.width > 0 && o.logo.height > 0) {
      // Brand logo: cover-fit into a rounded 44×44 square so any aspect works.
      const s = 44;
      ctx.save();
      roundRect(ctx, x, y, s, s, 10);
      ctx.clip();
      const r = Math.max(s / o.logo.width, s / o.logo.height);
      const dw = o.logo.width * r;
      const dh = o.logo.height * r;
      ctx.drawImage(o.logo, x + (s - dw) / 2, y + (s - dh) / 2, dw, dh);
      ctx.restore();
      markEnd = x + s + 16;
    } else {
      ctx.fillStyle = accent;
      roundRect(ctx, x, y, 10, 44, 5);
      ctx.fill();
    }
    ctx.fillStyle = text;
    ctx.font = face(600, 29);
    ctx.textBaseline = "middle";
    ctx.fillText(app, markEnd, y + 23);
  };

  switch (o.template) {
    // ---- Minimal / Dark: brand lockup, centred headline, footer URL ----------
    case "minimal":
    case "dark": {
      const dark = o.template === "dark";
      const P = dark ? DK : { bg: "#ffffff", ...INK };
      const accent = dark ? inkOnDark(rgb) : inkOnLight(rgb);
      const pad = 84;
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, 0, OG_W, OG_H);
      lockup(pad, pad, accent, P.t);

      const maxW = OG_W - pad * 2;
      const ft = fitTitle(ctx, title, fam, maxW, 2, 86, 46);
      ctx.font = face(400, 33);
      const dl = desc ? clampLines(ctx, desc, maxW, 2) : [];
      const total = ft.lines.length * ft.lh + (dl.length ? 26 + dl.length * 46 : 0);
      let y = 196 + Math.max(0, (OG_H - 346 - total) / 2);
      ctx.fillStyle = P.t;
      ctx.font = face(700, ft.size);
      y = drawLines(ctx, ft.lines, pad, y, ft.lh);
      if (dl.length) {
        y += 26;
        ctx.fillStyle = P.sub;
        ctx.font = face(400, 33);
        drawLines(ctx, dl, pad, y, 46);
      }
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, OG_H - 104);
      ctx.lineTo(OG_W - pad, OG_H - 104);
      ctx.stroke();
      if (url) {
        ctx.fillStyle = accent;
        ctx.font = face(500, 27);
        ctx.textBaseline = "middle";
        ctx.fillText(url, pad, OG_H - 64);
      }
      break;
    }

    // ---- Brand: solid brand field, oversized headline ------------------------
    case "brand": {
      const on = onBrand(rgb);
      const pad = 84;
      ctx.fillStyle = brand;
      ctx.fillRect(0, 0, OG_W, OG_H);
      lockup(pad, pad, on, on);
      const maxW = OG_W - pad * 2;
      const ft = fitTitle(ctx, title, fam, maxW, 3, 96, 50);
      let y = 210;
      ctx.fillStyle = on;
      ctx.font = face(700, ft.size);
      y = drawLines(ctx, ft.lines, pad, y, ft.lh);
      if (url) {
        ctx.fillStyle = withA(luminance(rgb) > 0.62 ? [24, 24, 27] : [255, 255, 255], 0.82);
        ctx.font = face(500, 28);
        ctx.textBaseline = "alphabetic";
        ctx.fillText(url, pad, OG_H - 70);
      }
      break;
    }

    // ---- Split: brand panel (left) + content (right) -------------------------
    case "split": {
      const lw = 460;
      const on = onBrand(rgb);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.fillStyle = brand;
      ctx.fillRect(0, 0, lw, OG_H);
      // big initial mark + app name on the panel
      ctx.fillStyle = withA(luminance(rgb) > 0.62 ? [24, 24, 27] : [255, 255, 255], 0.16);
      ctx.font = face(700, 280);
      ctx.textBaseline = "alphabetic";
      ctx.fillText((app[0] || "S").toUpperCase(), 56, 360);
      ctx.fillStyle = on;
      ctx.font = face(600, 30);
      ctx.textBaseline = "middle";
      ctx.fillText(app, 60, OG_H - 70);

      const cx = lw + 64;
      const maxW = OG_W - cx - 64;
      const ft = fitTitle(ctx, title, fam, maxW, 3, 64, 40);
      ctx.font = face(400, 30);
      const dl = desc ? clampLines(ctx, desc, maxW, 2) : [];
      const total = ft.lines.length * ft.lh + (dl.length ? 22 + dl.length * 42 : 0);
      let y = Math.max(150, (OG_H - total) / 2);
      ctx.fillStyle = INK.t;
      ctx.font = face(700, ft.size);
      y = drawLines(ctx, ft.lines, cx, y, ft.lh);
      if (dl.length) {
        y += 22;
        ctx.fillStyle = INK.sub;
        ctx.font = face(400, 30);
        y = drawLines(ctx, dl, cx, y, 42);
      }
      if (url) {
        ctx.fillStyle = inkOnLight(rgb);
        ctx.font = face(500, 26);
        ctx.fillText(url, cx, OG_H - 70);
      }
      break;
    }

    // ---- Grid: dotted texture, pill brand chip -------------------------------
    case "grid": {
      const pad = 84;
      ctx.fillStyle = "#fcfcfd";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.fillStyle = "#e6e6ea";
      for (let gx = 48; gx < OG_W; gx += 38) {
        for (let gy = 48; gy < OG_H; gy += 38) {
          ctx.beginPath();
          ctx.arc(gx, gy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // pill chip
      ctx.font = face(600, 26);
      const cw = ctx.measureText(app).width + 56;
      ctx.fillStyle = brand;
      roundRect(ctx, pad, pad, cw, 50, 25);
      ctx.fill();
      ctx.fillStyle = onBrand(rgb);
      ctx.textBaseline = "middle";
      ctx.beginPath();
      ctx.arc(pad + 28, pad + 25, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(app, pad + 44, pad + 26);

      const maxW = OG_W - pad * 2;
      const ft = fitTitle(ctx, title, fam, maxW, 2, 82, 46);
      let y = 250;
      ctx.fillStyle = INK.t;
      ctx.font = face(700, ft.size);
      ctx.textBaseline = "top";
      y = drawLines(ctx, ft.lines, pad, y, ft.lh);
      if (desc) {
        y += 24;
        ctx.fillStyle = INK.sub;
        ctx.font = face(400, 32);
        drawLines(ctx, clampLines(ctx, desc, maxW, 2), pad, y, 44);
      }
      if (url) {
        ctx.fillStyle = inkOnLight(rgb);
        ctx.font = face(500, 27);
        ctx.textBaseline = "alphabetic";
        ctx.fillText(url, pad, OG_H - 64);
      }
      break;
    }

    // ---- Editorial: kicker + rule, oversized headline, byline ----------------
    case "editorial": {
      const pad = 84;
      const ink = inkOnLight(rgb);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.fillStyle = ink;
      ctx.font = face(700, 24);
      ctx.textBaseline = "alphabetic";
      ctx.fillText(app.toUpperCase(), pad, pad + 18);
      const kw = ctx.measureText(app.toUpperCase()).width;
      ctx.strokeStyle = INK.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad + kw + 20, pad + 10);
      ctx.lineTo(OG_W - pad, pad + 10);
      ctx.stroke();

      const maxW = OG_W - pad * 2;
      const ft = fitTitle(ctx, title, fam, maxW, 2, 96, 52);
      let y = 188;
      ctx.fillStyle = INK.t;
      ctx.font = face(700, ft.size);
      ctx.textBaseline = "top";
      y = drawLines(ctx, ft.lines, pad, y, ft.lh);
      if (desc) {
        y += 18;
        ctx.fillStyle = INK.sub;
        ctx.font = face(400, 30);
        drawLines(ctx, clampLines(ctx, desc, maxW, 2), pad, y, 42);
      }
      ctx.fillStyle = INK.mut;
      ctx.font = face(500, 25);
      ctx.textBaseline = "alphabetic";
      ctx.fillText(url || domain, pad, OG_H - 60);
      break;
    }

    // ---- Glow: near-black with a soft brand radial -------------------------
    case "glow": {
      const pad = 84;
      ctx.fillStyle = "#0a0a0c";
      ctx.fillRect(0, 0, OG_W, OG_H);
      const g = ctx.createRadialGradient(OG_W - 180, 150, 40, OG_W - 180, 150, 620);
      g.addColorStop(0, withA(rgb, 0.55));
      g.addColorStop(0.5, withA(rgb, 0.12));
      g.addColorStop(1, withA(rgb, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, OG_W, OG_H);
      lockup(pad, pad, inkOnDark(rgb), DK.t);

      const maxW = OG_W - pad * 2 - 120;
      const ft = fitTitle(ctx, title, fam, maxW, 2, 84, 46);
      let y = 210;
      ctx.fillStyle = "#fafafa";
      ctx.font = face(700, ft.size);
      ctx.textBaseline = "top";
      y = drawLines(ctx, ft.lines, pad, y, ft.lh);
      if (desc) {
        y += 24;
        ctx.fillStyle = "#b4b4bb";
        ctx.font = face(400, 32);
        drawLines(ctx, clampLines(ctx, desc, maxW, 2), pad, y, 44);
      }
      if (url) {
        ctx.fillStyle = inkOnDark(rgb);
        ctx.font = face(500, 27);
        ctx.textBaseline = "alphabetic";
        ctx.fillText(url, pad, OG_H - 64);
      }
      break;
    }

    // ---- Sidebar: full-height brand band with vertical wordmark -------------
    case "sidebar": {
      const bw = 132;
      const on = onBrand(rgb);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.fillStyle = brand;
      ctx.fillRect(0, 0, bw, OG_H);
      ctx.save();
      ctx.translate(bw / 2 + 10, OG_H - 70);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = on;
      ctx.font = face(600, 30);
      ctx.textBaseline = "middle";
      ctx.fillText(app.toUpperCase(), 0, 0);
      ctx.restore();

      const cx = bw + 70;
      const maxW = OG_W - cx - 70;
      const ft = fitTitle(ctx, title, fam, maxW, 3, 76, 44);
      ctx.font = face(400, 31);
      const dl = desc ? clampLines(ctx, desc, maxW, 2) : [];
      const total = ft.lines.length * ft.lh + (dl.length ? 24 + dl.length * 44 : 0);
      let y = Math.max(150, (OG_H - total) / 2);
      ctx.fillStyle = INK.t;
      ctx.font = face(700, ft.size);
      ctx.textBaseline = "top";
      y = drawLines(ctx, ft.lines, cx, y, ft.lh);
      if (dl.length) {
        y += 24;
        ctx.fillStyle = INK.sub;
        ctx.font = face(400, 31);
        y = drawLines(ctx, dl, cx, y, 44);
      }
      if (url) {
        ctx.fillStyle = inkOnLight(rgb);
        ctx.font = face(500, 26);
        ctx.fillText(url, cx, OG_H - 66);
      }
      break;
    }

    // ---- Footer: white field + full-width brand footer bar ------------------
    case "footer": {
      const pad = 84;
      const fh = 132;
      const on = onBrand(rgb);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.fillStyle = brand;
      ctx.fillRect(0, OG_H - fh, OG_W, fh);

      const maxW = OG_W - pad * 2;
      const ft = fitTitle(ctx, title, fam, maxW, 2, 80, 46);
      let y = 150;
      ctx.fillStyle = INK.t;
      ctx.font = face(700, ft.size);
      ctx.textBaseline = "top";
      y = drawLines(ctx, ft.lines, pad, y, ft.lh);
      if (desc) {
        y += 22;
        ctx.fillStyle = INK.sub;
        ctx.font = face(400, 32);
        drawLines(ctx, clampLines(ctx, desc, maxW, 2), pad, y, 44);
      }
      ctx.fillStyle = on;
      ctx.font = face(600, 30);
      ctx.textBaseline = "middle";
      ctx.fillText(app, pad, OG_H - fh / 2);
      if (url) {
        ctx.font = face(500, 27);
        ctx.textAlign = "right";
        ctx.fillStyle = withA(luminance(rgb) > 0.62 ? [24, 24, 27] : [255, 255, 255], 0.85);
        ctx.fillText(url, OG_W - pad, OG_H - fh / 2);
        ctx.textAlign = "left";
      }
      break;
    }

    // ---- Frame: inset hairline brand border, centred ------------------------
    case "frame": {
      const m = 44;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.strokeStyle = brand;
      ctx.lineWidth = 3;
      roundRect(ctx, m, m, OG_W - m * 2, OG_H - m * 2, 22);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillStyle = inkOnLight(rgb);
      ctx.font = face(600, 26);
      ctx.textBaseline = "alphabetic";
      ctx.fillText(app.toUpperCase(), OG_W / 2, 168);

      const maxW = OG_W - 280;
      const ft = fitTitle(ctx, title, fam, maxW, 3, 78, 44);
      ctx.font = face(400, 30);
      const dl = desc ? clampLines(ctx, desc, maxW, 2) : [];
      const total = ft.lines.length * ft.lh + (dl.length ? 22 + dl.length * 42 : 0);
      let y = 220 + Math.max(0, (200 - total) / 2);
      ctx.fillStyle = INK.t;
      ctx.font = face(700, ft.size);
      ctx.textBaseline = "top";
      for (const line of ft.lines) {
        ctx.fillText(line, OG_W / 2, y);
        y += ft.lh;
      }
      if (dl.length) {
        y += 22;
        ctx.fillStyle = INK.sub;
        ctx.font = face(400, 30);
        for (const line of dl) {
          ctx.fillText(line, OG_W / 2, y);
          y += 42;
        }
      }
      if (url) {
        ctx.fillStyle = INK.mut;
        ctx.font = face(500, 25);
        ctx.fillText(url, OG_W / 2, OG_H - 80);
      }
      ctx.textAlign = "left";
      break;
    }

    // ---- Card: standard rich link-preview (favicon · domain · thumb) --------
    case "card": {
      ctx.fillStyle = "#f4f4f5";
      ctx.fillRect(0, 0, OG_W, OG_H);
      const cx = 80;
      const cy = 90;
      const cw = OG_W - 160;
      const ch = OG_H - 180;
      ctx.save();
      ctx.shadowColor = "rgba(24,24,27,0.16)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 16;
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, cx, cy, cw, ch, 24);
      ctx.fill();
      ctx.restore();

      const thumbW = 300;
      // thumbnail block (brand tint) on the right — flush left, rounded right
      ctx.fillStyle = withA(rgb, 0.1);
      roundRightRect(ctx, cx + cw - thumbW, cy, thumbW, ch, 24);
      ctx.fill();
      ctx.fillStyle = brand;
      ctx.font = face(700, 120);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((app[0] || "S").toUpperCase(), cx + cw - thumbW / 2, cy + ch / 2);
      ctx.textAlign = "left";

      const tx = cx + 56;
      const tw = cw - thumbW - 100;
      // favicon dot + domain
      ctx.fillStyle = brand;
      ctx.beginPath();
      ctx.arc(tx + 16, cy + 78, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = face(700, 17);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((app[0] || "S").toUpperCase(), tx + 16, cy + 79);
      ctx.textAlign = "left";
      ctx.fillStyle = INK.sub;
      ctx.font = face(500, 24);
      ctx.fillText(domain || app, tx + 44, cy + 79);

      const ft = fitTitle(ctx, title, fam, tw, 3, 52, 32);
      let y = cy + 132;
      ctx.fillStyle = INK.t;
      ctx.font = face(700, ft.size);
      ctx.textBaseline = "top";
      y = drawLines(ctx, ft.lines, tx, y, ft.lh);
      if (desc) {
        y += 16;
        ctx.fillStyle = INK.sub;
        ctx.font = face(400, 26);
        drawLines(ctx, clampLines(ctx, desc, tw, 2), tx, y, 36);
      }
      break;
    }

    // ---- Mono: dark, tracked wordmark, accent underline ---------------------
    default: {
      const pad = 84;
      ctx.fillStyle = "#0b0b0d";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.fillStyle = inkOnDark(rgb);
      ctx.beginPath();
      ctx.arc(pad + 7, pad + 20, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e4e4e7";
      ctx.font = face(500, 26);
      ctx.textBaseline = "middle";
      ctx.fillText(app, pad + 28, pad + 21);

      const maxW = OG_W - pad * 2;
      const ft = fitTitle(ctx, title, fam, maxW, 2, 82, 46);
      let y = 230;
      ctx.fillStyle = "#fafafa";
      ctx.font = face(700, ft.size);
      ctx.textBaseline = "top";
      const endY = drawLines(ctx, ft.lines, pad, y, ft.lh);
      ctx.fillStyle = inkOnDark(rgb);
      roundRect(ctx, pad, endY + 10, 96, 7, 3.5);
      ctx.fill();
      y = endY + 44;
      if (desc) {
        ctx.fillStyle = "#a1a1aa";
        ctx.font = face(400, 31);
        drawLines(ctx, clampLines(ctx, desc, maxW, 2), pad, y, 44);
      }
      if (url) {
        ctx.fillStyle = "#71717a";
        ctx.font = face(500, 26);
        ctx.textBaseline = "alphabetic";
        ctx.fillText(url, pad, OG_H - 64);
      }
      break;
    }
  }
}

/** Generated cards are flat-colour with crisp text → PNG keeps edges sharp and
 *  still compresses small (~30–80KB), unlike JPEG which fringes the type. */
export function ogToPng(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

/** Downscale an uploaded photo to ≤maxW and re-encode as JPEG so user uploads
 *  stay small (photos compress far better as JPEG than PNG). */
export async function compressUpload(
  file: File,
  maxW = 1200,
  quality = 0.85,
): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return c.toDataURL("image/jpeg", quality);
}
