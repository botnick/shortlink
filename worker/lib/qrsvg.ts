import qrcode from "qrcode-generator";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** SVG path for one rounded module cell. */
function cellPath(x: number, y: number, s: number, r: number): string {
  const rr = Math.min(r, s / 2);
  const f = (n: number) => n.toFixed(2);
  return (
    `M${f(x + rr)} ${f(y)}h${f(s - 2 * rr)}a${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} ${f(rr)}` +
    `v${f(s - 2 * rr)}a${f(rr)} ${f(rr)} 0 0 1 -${f(rr)} ${f(rr)}h-${f(s - 2 * rr)}` +
    `a${f(rr)} ${f(rr)} 0 0 1 -${f(rr)} -${f(rr)}v-${f(s - 2 * rr)}a${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} -${f(rr)}z`
  );
}

/**
 * Render a styled, scannable QR as an SVG string — pure JS (no DOM/canvas), so
 * it runs in the Worker. Mirrors the look of the QR the app generates: rounded
 * modules, near-black data with brand-coloured finder corners, and an optional
 * centre logo (error-correction is raised to H so the logo can't break a scan).
 */
export function qrSvg(
  data: string,
  opts: {
    fg?: string;
    brand?: string;
    light?: string;
    margin?: number;
    size?: number;
    logo?: string | null;
  } = {},
): string {
  const fg = opts.fg ?? "#000000";
  const brand = opts.brand ?? fg;
  const light = opts.light ?? "#ffffff";
  const margin = opts.margin ?? 4;
  const size = opts.size ?? 1024;
  const logo =
    opts.logo && (opts.logo.startsWith("data:") || opts.logo.startsWith("http"))
      ? opts.logo
      : null;

  const qr = qrcode(0, logo ? "H" : "Q");
  qr.addData(data);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / (count + margin * 2);
  const radius = cell * 0.28;

  // Reserve a clear square in the centre for the logo (ECC H tolerates it).
  const hole = logo ? Math.round(count * 0.2) : 0;
  const holeLo = Math.floor((count - hole) / 2);
  const holeHi = holeLo + hole;
  const inHole = (r: number, c: number) =>
    logo !== null && r >= holeLo && r < holeHi && c >= holeLo && c < holeHi;

  // The three 7×7 finder patterns (corners) get the brand colour.
  const F = 7;
  const isFinder = (r: number, c: number) =>
    (r < F && c < F) || (r < F && c >= count - F) || (r >= count - F && c < F);

  let dData = "";
  let dFinder = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!qr.isDark(r, c) || inHole(r, c)) continue;
      const p = cellPath((c + margin) * cell, (r + margin) * cell, cell, radius);
      if (isFinder(r, c)) dFinder += p;
      else dData += p;
    }
  }

  let center = "";
  if (logo) {
    const pad = cell * 0.8;
    const x = (holeLo + margin) * cell - pad;
    const y = x;
    const box = hole * cell + pad * 2;
    center =
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${box.toFixed(2)}" ` +
      `height="${box.toFixed(2)}" rx="${(cell * 1.4).toFixed(2)}" fill="${light}"/>` +
      `<image x="${(x + pad * 0.7).toFixed(2)}" y="${(y + pad * 0.7).toFixed(2)}" ` +
      `width="${(box - pad * 1.4).toFixed(2)}" height="${(box - pad * 1.4).toFixed(2)}" ` +
      `preserveAspectRatio="xMidYMid meet" href="${esc(logo)}"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${light}"/>` +
    `<path fill="${fg}" d="${dData}"/>` +
    (dFinder ? `<path fill="${brand}" d="${dFinder}"/>` : "") +
    center +
    `</svg>`
  );
}
