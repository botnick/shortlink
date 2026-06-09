/**
 * Branded, no-JS pages served straight from the worker on the short-link path:
 * the password unlock prompt and the 404/410 link-error pages. They share one
 * card shell so every interstitial a visitor can hit looks like the same
 * product — logo, brand colour, type, light/dark — without shipping the SPA.
 *
 * Pure (config in, HTML string out) so the pages can be rendered outside the
 * worker too — see scripts/brand-pages-preview.ts. The worker-facing Response
 * wrappers live in worker/lib/brandPages.ts.
 */

/** The slice of app config the shell needs (subset of AppConfigDTO). */
export interface BrandBits {
  appName: string;
  brandColor: string;
  logoUrl: string;
}

interface ShellOpts {
  /** Document title, shown as "{appName} — {title}". */
  title: string;
  /** Small mono status label above the heading (e.g. "404"). */
  code?: string;
  heading: string;
  sub: string;
  /** Pre-escaped HTML rendered inside the card (form, action button). */
  body: string;
}

const htmlEsc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderShell(cfg: BrandBits, o: ShellOpts): string {
  const brand = /^#[0-9a-fA-F]{6}$/.test(cfg.brandColor) ? cfg.brandColor : "#e5392e";
  const app = htmlEsc(cfg.appName || "Shortlink");
  const logo = cfg.logoUrl
    ? `<img src="${htmlEsc(cfg.logoUrl)}" alt="" width="44" height="44" style="border-radius:10px;object-fit:cover">`
    : `<div style="width:44px;height:44px;border-radius:10px;background:${brand}"></div>`;
  const code = o.code ? `<p class="code">${o.code}</p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${app} — ${htmlEsc(o.title)}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:"IBM Plex Sans Thai",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f4f5;color:#18181b}
.card{width:100%;max-width:380px;background:#fff;border:1px solid #e7e7ea;border-radius:18px;padding:32px;box-shadow:0 8px 30px rgba(0,0,0,.06);text-align:center}
.mark{display:flex;justify-content:center;margin-bottom:18px}
.code{margin:0 0 4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;letter-spacing:.12em;color:#a1a1aa}
h1{margin:0 0 6px;font-size:19px;font-weight:600}
.sub{margin:0 0 22px;color:#71717a;font-size:14px;line-height:1.5}
form{display:flex;flex-direction:column;gap:12px;text-align:left}
input{height:44px;border:1px solid #d4d4d8;border-radius:10px;padding:0 14px;font-size:16px;outline:none;background:transparent;color:inherit}
input:focus{border-color:${brand};box-shadow:0 0 0 3px ${brand}22}
button,.btn{display:inline-flex;align-items:center;justify-content:center;height:44px;border:0;border-radius:10px;padding:0 22px;background:${brand};color:#fff;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none}
.err{margin:2px 0 0;color:#dc2626;font-size:13px}
.foot{margin:22px 0 0;color:#a1a1aa;font-size:12px}
@media(prefers-color-scheme:dark){
body{background:#101013;color:#fafafa}
.card{background:#18181b;border-color:#27272a;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.sub{color:#a1a1aa}.code,.foot{color:#71717a}
input{border-color:#3f3f46}.err{color:#f87171}
}
</style></head><body><div class="card"><div class="mark">${logo}</div>${code}<h1>${htmlEsc(o.heading)}</h1><p class="sub">${htmlEsc(o.sub)}</p>${o.body}<p class="foot">${app}</p></div></body></html>`;
}

export function passwordPageHtml(cfg: BrandBits, slug: string, error?: string): string {
  const err = error ? `<p class="err">${htmlEsc(error)}</p>` : "";
  return renderShell(cfg, {
    title: "Protected link",
    heading: "Protected link",
    sub: "Enter the password to continue.",
    body: `<form method="POST" action="/api/unlock/${htmlEsc(slug)}"><input type="password" name="password" placeholder="Password" autofocus required autocomplete="off">${err}<button type="submit">Unlock</button></form>`,
  });
}

export type LinkErrorKind = "not-found" | "expired" | "disabled";

export const LINK_ERRORS: Record<
  LinkErrorKind,
  { code: string; status: 404 | 410; heading: string; sub: string }
> = {
  "not-found": {
    code: "404",
    status: 404,
    heading: "Link not found",
    sub: "There’s no link at this address. It may have been mistyped or removed.",
  },
  expired: {
    code: "410",
    status: 410,
    heading: "Link expired",
    sub: "This link has reached its expiry date and no longer works.",
  },
  disabled: {
    code: "410",
    status: 410,
    heading: "Link unavailable",
    sub: "This link has been turned off by its owner.",
  },
};

export function linkErrorHtml(cfg: BrandBits, kind: LinkErrorKind): string {
  const e = LINK_ERRORS[kind];
  return renderShell(cfg, {
    title: e.heading,
    code: e.code,
    heading: e.heading,
    sub: e.sub,
    body: `<a class="btn" href="/">Go to homepage</a>`,
  });
}
