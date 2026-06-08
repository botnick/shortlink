// Small color helpers + harmony generator: pick one main color, get matching
// schemes for the dots + the two eye parts.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1 / 3) * 255,
    hue2rgb(p, q, h) * 255,
    hue2rgb(p, q, h - 1 / 3) * 255,
  ];
}

export function adjustLightness(hex: string, delta: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return rgbToHex(...hslToRgb(h, s, clamp(l + delta, 0, 1)));
}

export function rotateHue(hex: string, deg: number): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return rgbToHex(...hslToRgb((((h + deg / 360) % 1) + 1) % 1, s, l));
}

/** Nudge a color to be vivid + dark enough to scan on a white background. */
export function ensureReadable(hex: string): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const s2 = s < 0.08 ? s : Math.max(s, 0.3); // keep grays gray
  return rgbToHex(...hslToRgb(h, s2, Math.min(l, 0.5)));
}

export interface ColorScheme {
  id: string;
  label: string;
  fg: string;
  cornerSquareColor: string;
  cornerDotColor: string;
}

/** Coordinated, scannable color schemes derived from one main color. */
export function schemesFor(main: string): ColorScheme[] {
  const base = ensureReadable(main);
  const deep = adjustLightness(base, -0.16);
  const comp = ensureReadable(rotateHue(main, 180));
  const anaL = ensureReadable(rotateHue(main, -32));
  const anaR = ensureReadable(rotateHue(main, 32));
  const triad = ensureReadable(rotateHue(main, 120));
  const ink = "#15181f";
  return [
    { id: "solid", label: "Solid", fg: base, cornerSquareColor: base, cornerDotColor: base },
    { id: "deep", label: "Bold eyes", fg: base, cornerSquareColor: deep, cornerDotColor: deep },
    { id: "ink", label: "Ink + accent", fg: ink, cornerSquareColor: base, cornerDotColor: base },
    { id: "complement", label: "Complement", fg: base, cornerSquareColor: comp, cornerDotColor: comp },
    { id: "analogous", label: "Analogous", fg: base, cornerSquareColor: anaL, cornerDotColor: anaR },
    { id: "triad", label: "Triad", fg: base, cornerSquareColor: triad, cornerDotColor: comp },
  ];
}
