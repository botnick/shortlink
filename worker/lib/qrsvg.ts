import qrcode from "qrcode-generator";

/**
 * Render a scannable QR code as an SVG string — pure JS (no DOM/canvas), so it
 * runs in the Worker. Used to serve a direct, embeddable QR image at
 * /qr/<slug>.svg. `dark` is the module colour (brand), `light` the background.
 */
export function qrSvg(
  data: string,
  opts: { dark?: string; light?: string; margin?: number; size?: number } = {},
): string {
  const dark = opts.dark ?? "#000000";
  const light = opts.light ?? "#ffffff";
  const margin = opts.margin ?? 4;
  const size = opts.size ?? 1024;

  const qr = qrcode(0, "M"); // auto type, error-correction level M
  qr.addData(data);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / (count + margin * 2);

  // One <path> for all dark modules keeps the SVG compact and fast to parse.
  let d = "";
  for (let r = 0; r < count; r++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(r, col)) {
        const x = ((col + margin) * cell).toFixed(2);
        const y = ((r + margin) * cell).toFixed(2);
        d += `M${x} ${y}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="${light}"/>` +
    `<path fill="${dark}" d="${d}"/></svg>`
  );
}
