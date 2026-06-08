import QRCodeStyling, { type Options as QrOptions } from "qr-code-styling";

export type DotType =
  | "square"
  | "dots"
  | "rounded"
  | "extra-rounded"
  | "classy"
  | "classy-rounded";
export type SquareType = "square" | "dot" | "extra-rounded";
export type DotCornerType = "square" | "dot";
export type Ecc = "L" | "M" | "Q" | "H";
export type FrameStyle =
  | "none"
  | "box"
  | "bottom"
  | "top"
  | "pill"
  | "tag"
  | "ribbon"
  | "bubble"
  | "dual"
  | "ticket"
  | "underline";

export interface QrCfg {
  dotsType: DotType;
  fg: string;
  gradient: boolean;
  gradientType: "linear" | "radial";
  fg2: string;
  rotation: number;
  cornerSquareType: SquareType;
  cornerSquareColor: string;
  cornerDotType: DotCornerType;
  cornerDotColor: string;
  bg: string;
  transparent: boolean;
  logo: boolean;
  logoSrc: string;
  logoSize: number;
  logoMargin: number;
  hideBgDots: boolean;
  frameStyle: FrameStyle;
  frameText: string;
  frameColor: string;
  frameTextColor: string;
  frameIcon: boolean;
  frameRound: boolean;
  ecc: Ecc;
  margin: number;
  exportSize: number;
}

export function makeDefault(brand: string): QrCfg {
  return {
    dotsType: "rounded",
    fg: "#000000",
    gradient: false,
    gradientType: "linear",
    fg2: brand,
    rotation: 45,
    cornerSquareType: "extra-rounded",
    cornerSquareColor: "#000000",
    cornerDotType: "dot",
    cornerDotColor: "#000000",
    bg: "#ffffff",
    transparent: false,
    logo: false,
    logoSrc: "",
    logoSize: 0.3,
    logoMargin: 4,
    hideBgDots: true,
    frameStyle: "none",
    frameText: "SCAN ME",
    frameColor: brand,
    frameTextColor: "#ffffff",
    frameIcon: true,
    frameRound: true,
    ecc: "Q",
    margin: 12,
    exportSize: 1024,
  };
}

const QR_BASE = 1000;

export function qrOptions(cfg: QrCfg, data: string): Partial<QrOptions> {
  return {
    width: QR_BASE,
    height: QR_BASE,
    type: "svg",
    data,
    margin: cfg.margin,
    image: cfg.logo && cfg.logoSrc ? cfg.logoSrc : undefined,
    qrOptions: { errorCorrectionLevel: cfg.ecc },
    dotsOptions: cfg.gradient
      ? {
          type: cfg.dotsType,
          gradient: {
            type: cfg.gradientType,
            rotation: (cfg.rotation * Math.PI) / 180,
            colorStops: [
              { offset: 0, color: cfg.fg },
              { offset: 1, color: cfg.fg2 },
            ],
          },
        }
      : { type: cfg.dotsType, color: cfg.fg },
    cornersSquareOptions: { type: cfg.cornerSquareType, color: cfg.cornerSquareColor },
    cornersDotOptions: { type: cfg.cornerDotType, color: cfg.cornerDotColor },
    backgroundOptions: { color: cfg.transparent ? "transparent" : cfg.bg },
    imageOptions: {
      margin: cfg.logoMargin,
      imageSize: cfg.logoSize,
      hideBackgroundDots: cfg.hideBgDots,
      crossOrigin: "anonymous",
    },
  };
}

export async function renderQrSvg(cfg: QrCfg, data: string): Promise<string> {
  const inst = new QRCodeStyling(qrOptions(cfg, data));
  const raw = await inst.getRawData("svg");
  if (!raw) throw new Error("render failed");
  const blob = raw instanceof Blob ? raw : new Blob([raw], { type: "image/svg+xml" });
  return await blob.text();
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${b64(svg)}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A scan/viewfinder glyph (four corner brackets), centered on cx,cy. */
function scanIcon(cx: number, cy: number, s: number, color: string): string {
  const r = s / 2;
  const t = s * 0.34;
  const w = Math.max(4, s * 0.13);
  const c = (d: string) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return (
    c(`M ${cx - r} ${cy - r + t} V ${cy - r} H ${cx - r + t}`) +
    c(`M ${cx + r - t} ${cy - r} H ${cx + r} V ${cy - r + t}`) +
    c(`M ${cx + r} ${cy + r - t} V ${cy + r} H ${cx + r - t}`) +
    c(`M ${cx - r + t} ${cy + r} H ${cx - r} V ${cy + r - t}`)
  );
}

export interface Composed {
  svg: string;
  width: number;
  height: number;
}

/** Wrap the QR in one of several frames — all drawn as our own SVG. */
export function composeFrame(qrSvg: string, cfg: QrCfg): Composed {
  const S = QR_BASE;
  const fc = cfg.frameColor;
  const tc = cfg.frameTextColor;
  const txt = cfg.frameText.trim();
  const pad = 32;
  const box = S + pad * 2;
  const R = (v: number) => (cfg.frameRound ? v : Math.min(v, 6));

  const qrAt = (x: number, y: number) =>
    `<image x="${x}" y="${y}" width="${S}" height="${S}" href="${svgDataUrl(qrSvg)}"/>`;
  const label = (cx: number, cy: number, color: string, size = 46) => {
    if (!txt) return "";
    const tw = txt.length * size * 0.62;
    const iconS = cfg.frameIcon ? size * 1.1 : 0;
    const gap = cfg.frameIcon ? 22 : 0;
    const start = cx - (iconS + gap + tw) / 2;
    const icon = cfg.frameIcon ? scanIcon(start + iconS / 2, cy, iconS, color) : "";
    return (
      icon +
      `<text x="${start + iconS + gap}" y="${cy}" text-anchor="start" dominant-baseline="central" font-family="'IBM Plex Sans Thai','Segoe UI',sans-serif" font-size="${size}" font-weight="700" letter-spacing="2" fill="${color}">${escapeXml(txt)}</text>`
    );
  };
  const wrap = (w: number, h: number, body: string): Composed => ({
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
    width: w,
    height: h,
  });

  switch (cfg.frameStyle) {
    case "none":
      return { svg: qrSvg, width: S, height: S };

    case "box": {
      const m = 28;
      const w = box + m * 2;
      return wrap(w, w, `<rect x="${m}" y="${m}" width="${box}" height="${box}" rx="${R(44)}" fill="#ffffff" stroke="${fc}" stroke-width="16"/>` + qrAt(m + pad, m + pad));
    }

    case "bottom": {
      const m = 26;
      const cap = 124;
      const w = box + m * 2;
      const h = box + m * 2 + cap;
      return wrap(w, h, `<rect width="${w}" height="${h}" rx="${R(40)}" fill="${fc}"/>` + `<rect x="${m}" y="${m}" width="${box}" height="${box}" rx="${R(30)}" fill="#ffffff"/>` + qrAt(m + pad, m + pad) + label(w / 2, m + box + cap / 2, tc));
    }

    case "top": {
      const m = 26;
      const cap = 124;
      const w = box + m * 2;
      const h = box + m * 2 + cap;
      const by = m + cap;
      return wrap(w, h, `<rect width="${w}" height="${h}" rx="${R(40)}" fill="${fc}"/>` + `<rect x="${m}" y="${by}" width="${box}" height="${box}" rx="${R(30)}" fill="#ffffff"/>` + qrAt(m + pad, by + pad) + label(w / 2, m + cap / 2, tc));
    }

    case "pill": {
      const m = 24;
      const gap = 26;
      const ph = 100;
      const pw = Math.round(box * 0.72);
      const w = box + m * 2;
      const h = m + box + gap + ph + m;
      const px = (w - pw) / 2;
      const py = m + box + gap;
      return wrap(w, h, `<rect x="${m}" y="${m}" width="${box}" height="${box}" rx="${R(40)}" fill="#ffffff" stroke="${fc}" stroke-width="10"/>` + qrAt(m + pad, m + pad) + `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${ph / 2}" fill="${fc}"/>` + label(w / 2, py + ph / 2, tc));
    }

    case "tag": {
      const m = 24;
      const gap = 28;
      const bh = 120;
      const w = box + m * 2;
      const h = m + box + gap + bh + m;
      const by = m + box + gap;
      const cx = w / 2;
      return wrap(w, h, `<rect x="${m}" y="${m}" width="${box}" height="${box}" rx="${R(38)}" fill="#ffffff" stroke="${fc}" stroke-width="8"/>` + qrAt(m + pad, m + pad) + `<rect x="${m}" y="${by}" width="${box}" height="${bh}" rx="${R(38)}" fill="${fc}"/>` + `<path d="M ${cx - 30} ${by + 2} L ${cx + 30} ${by + 2} L ${cx} ${m + box + 2} Z" fill="${fc}"/>` + label(cx, by + bh / 2, tc));
    }

    case "ribbon": {
      const m = 50;
      const tail = 40;
      const gap = 24;
      const bh = 116;
      const w = box + m * 2;
      const by = m + box + gap;
      const h = by + bh + m;
      const x0 = m;
      const x1 = m + box;
      return wrap(w, h, `<rect x="${m}" y="${m}" width="${box}" height="${box}" rx="${R(38)}" fill="#ffffff" stroke="${fc}" stroke-width="8"/>` + qrAt(m + pad, m + pad) + `<path d="M ${x0} ${by} L ${x1} ${by} L ${x1 + tail} ${by + bh / 2} L ${x1} ${by + bh} L ${x0} ${by + bh} L ${x0 - tail} ${by + bh / 2} Z" fill="${fc}"/>` + label(w / 2, by + bh / 2, tc));
    }

    case "bubble": {
      const m = 34;
      const cap = 110;
      const tailW = 78;
      const tailH = 48;
      const w = box + m * 2;
      const bodyH = box + m * 2 + cap;
      const h = bodyH + tailH;
      return wrap(w, h, `<rect x="0" y="0" width="${w}" height="${bodyH}" rx="${R(60)}" fill="${fc}"/>` + `<path d="M ${w / 2 - tailW / 2} ${bodyH - 4} L ${w / 2 + tailW / 2} ${bodyH - 4} L ${w / 2 - tailW / 2 + 8} ${h} Z" fill="${fc}"/>` + `<rect x="${m}" y="${m}" width="${box}" height="${box}" rx="${R(40)}" fill="#ffffff"/>` + qrAt(m + pad, m + pad) + label(w / 2, m + box + cap / 2, tc));
    }

    case "dual": {
      const m = 24;
      const cap = 100;
      const w = box + m * 2;
      const wy = m + cap;
      const h = wy + box + cap + m;
      return wrap(w, h, `<rect width="${w}" height="${h}" rx="${R(40)}" fill="${fc}"/>` + `<rect x="${m}" y="${wy}" width="${box}" height="${box}" rx="${R(28)}" fill="#ffffff"/>` + qrAt(m + pad, wy + pad) + label(w / 2, m + cap / 2, tc, 42) + label(w / 2, wy + box + cap / 2, tc, 42));
    }

    case "ticket": {
      const m = 30;
      const cap = 116;
      const w = box + m * 2;
      const h = m + box + cap + m;
      const perfY = m + box + 14;
      let perf = "";
      const dots = 13;
      const span = box - 20;
      for (let i = 0; i < dots; i++) {
        perf += `<circle cx="${m + 10 + (span / (dots - 1)) * i}" cy="${perfY}" r="7" fill="#ffffff"/>`;
      }
      return wrap(w, h, `<rect width="${w}" height="${h}" rx="${R(44)}" fill="${fc}"/>` + `<rect x="${m}" y="${m}" width="${box}" height="${box}" rx="${R(28)}" fill="#ffffff"/>` + qrAt(m + pad, m + pad) + perf + label(w / 2, m + box + cap / 2 + 12, tc));
    }

    case "underline": {
      const m = 18;
      const cap = 120;
      const lw = Math.round(box * 0.46);
      const w = box + m * 2;
      const h = m + box + cap + m;
      const ly = m + box + 22;
      return wrap(w, h, qrAt(m + pad, m + pad) + `<rect x="${(w - lw) / 2}" y="${ly}" width="${lw}" height="9" rx="4" fill="${fc}"/>` + label(w / 2, ly + 58, fc, 44));
    }
  }
}

export function svgToRaster(
  composed: Composed,
  outSize: number,
  mime: "image/png" | "image/jpeg",
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = outSize / Math.max(composed.width, composed.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(composed.width * scale);
      canvas.height = Math.round(composed.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no ctx"));
      if (mime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), mime, 0.95);
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = svgDataUrl(composed.svg);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
