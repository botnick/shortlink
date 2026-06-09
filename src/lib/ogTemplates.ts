// Client-side OG-image generation — draws a 1200×630 social card on a <canvas>,
// so there's zero Worker CPU/cost. All templates are original.

export const OG_W = 1200;
export const OG_H = 630;

export const OG_TEMPLATES: { id: string; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "gradient", label: "Gradient" },
  { id: "bold", label: "Bold" },
  { id: "dark", label: "Dark" },
  { id: "split", label: "Split" },
  { id: "frame", label: "Frame" },
];

export interface OgOptions {
  template: string;
  title: string;
  appName: string;
  brandColor: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xe5392e;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade([r, g, b]: [number, number, number], f: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
function luminance([r, g, b]: [number, number, number]): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const FONT = `"IBM Plex Sans Thai", "Segoe UI", system-ui, sans-serif`;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/** Draw title with the largest weight that fits the box, word-wrapped. */
function drawTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  color: string,
  align: CanvasTextAlign = "left",
) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  let size = 78;
  let lines: string[] = [];
  for (; size >= 34; size -= 4) {
    ctx.font = `700 ${size}px ${FONT}`;
    lines = wrap(ctx, title, maxW);
    if (lines.length * size * 1.18 <= maxH) break;
  }
  const lh = size * 1.18;
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + lines.length * lh;
}

export function renderOg(canvas: HTMLCanvasElement, o: OgOptions) {
  canvas.width = OG_W;
  canvas.height = OG_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rgb = hexToRgb(o.brandColor);
  const brand = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const title = o.title.trim() || "Your headline goes here";
  const app = (o.appName || "Shortlink").toUpperCase();
  const onBrand = luminance(rgb) > 0.6 ? "#111827" : "#ffffff";
  const pad = 80;
  ctx.clearRect(0, 0, OG_W, OG_H);

  const appTag = (x: number, y: number, color: string, align: CanvasTextAlign = "left") => {
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(app, x, y);
  };

  switch (o.template) {
    case "gradient": {
      const g = ctx.createLinearGradient(0, 0, OG_W, OG_H);
      g.addColorStop(0, shade(rgb, 0.15));
      g.addColorStop(1, shade(rgb, -0.45));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, OG_W, OG_H);
      drawTitle(ctx, title, pad, 200, OG_W - pad * 2, 280, "#ffffff");
      appTag(pad, OG_H - 70, "rgba(255,255,255,0.85)");
      break;
    }
    case "bold": {
      ctx.fillStyle = brand;
      ctx.fillRect(0, 0, OG_W, OG_H);
      drawTitle(ctx, title, pad, 190, OG_W - pad * 2, 300, onBrand);
      ctx.globalAlpha = 0.8;
      appTag(pad, OG_H - 70, onBrand);
      ctx.globalAlpha = 1;
      break;
    }
    case "dark": {
      ctx.fillStyle = "#0b0e14";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.fillStyle = brand;
      ctx.fillRect(pad, 170, 84, 8);
      drawTitle(ctx, title, pad, 210, OG_W - pad * 2, 280, "#f3f4f6");
      ctx.fillStyle = brand;
      ctx.beginPath();
      ctx.arc(pad + 8, OG_H - 78, 8, 0, Math.PI * 2);
      ctx.fill();
      appTag(pad + 30, OG_H - 70, "#9ca3af");
      break;
    }
    case "split": {
      const lw = 440;
      ctx.fillStyle = brand;
      ctx.fillRect(0, 0, lw, OG_H);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(lw, 0, OG_W - lw, OG_H);
      ctx.save();
      ctx.translate(lw / 2, OG_H / 2);
      appTag(0, 0, onBrand, "center");
      ctx.restore();
      drawTitle(ctx, title, lw + 60, 180, OG_W - lw - 120, 300, "#111827");
      break;
    }
    case "frame": {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.strokeStyle = brand;
      ctx.lineWidth = 16;
      ctx.strokeRect(34, 34, OG_W - 68, OG_H - 68);
      drawTitle(ctx, title, pad, 210, OG_W - pad * 2, 240, "#111827", "left");
      appTag(pad, OG_H - 80, brand);
      break;
    }
    default: {
      // minimal
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, OG_W, OG_H);
      ctx.fillStyle = brand;
      ctx.fillRect(0, 0, 14, OG_H);
      drawTitle(ctx, title, pad, 200, OG_W - pad * 2, 280, "#111827");
      appTag(pad, OG_H - 70, brand);
    }
  }
}

export function ogDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", 0.86);
}
