/**
 * Branded, no-JS pages served straight from the worker on the short-link path:
 * the password unlock prompt, the 404/410/429/500 status pages, and an optional
 * link-safety interstitial. They share one card shell so every interstitial a
 * visitor can hit looks like the same product — logo, brand colour, type,
 * light/dark — without shipping the SPA.
 *
 * Pure (config + copy in, HTML string out) so the pages can be rendered outside
 * the worker too — see scripts/brand-pages-preview.ts. The worker-facing Response
 * wrappers live in worker/lib/brandPages.ts.
 *
 * NOTHING is hardcoded: the brand colour falls back to the shared default, and
 * every user-facing string comes from the caller (a resolved BrandCopy — admin
 * settings merged onto shared/defaults.ts) — never a literal in the renderer.
 */
import { DEFAULT_BRAND_COLOR } from "./defaults";
import type { BrandCopy } from "./types";

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
  /** Optional support link in the footer (blank url = hidden). */
  support?: { label: string; url: string };
}

const htmlEsc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderShell(cfg: BrandBits, o: ShellOpts): string {
  const brand = /^#[0-9a-fA-F]{6}$/.test(cfg.brandColor) ? cfg.brandColor : DEFAULT_BRAND_COLOR;
  const app = htmlEsc(cfg.appName || "Shortlink");
  const initial = htmlEsc((cfg.appName || "S").trim().charAt(0).toUpperCase());
  const logo = cfg.logoUrl
    ? `<img src="${htmlEsc(cfg.logoUrl)}" alt="" width="46" height="46">`
    : `<div class="ph" aria-hidden="true">${initial}</div>`;
  const code = o.code ? `<p class="code">${htmlEsc(o.code)}</p>` : "";
  const support =
    o.support && o.support.url
      ? ` · <a href="${htmlEsc(o.support.url)}">${htmlEsc(o.support.label || "Support")}</a>`
      : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="${brand}"><title>${app} — ${htmlEsc(o.title)}</title><style>
:root{--b:${brand};--bg:#fafafa;--card:#fff;--bd:#ececef;--fg:#18181b;--mut:#71717a;--faint:#a1a1aa}
@media(prefers-color-scheme:dark){:root{--bg:#0a0a0c;--card:#141417;--bd:#26262b;--fg:#fafafa;--mut:#a1a1aa;--faint:#6b6b73}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--fg);font-family:"IBM Plex Sans Thai",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5}
.card{position:relative;width:100%;max-width:392px;background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:40px 32px 28px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px -12px rgba(0,0,0,.12);overflow:hidden}
.card::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:var(--b)}
.mark{display:flex;justify-content:center;margin-bottom:20px}
.mark img,.ph{width:46px;height:46px;border-radius:12px;object-fit:cover}
.ph{display:flex;align-items:center;justify-content:center;background:var(--b);color:#fff;font-size:22px;font-weight:700;letter-spacing:-.01em}
.code{margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:600;letter-spacing:.14em;color:var(--b)}
h1{margin:0 0 8px;font-size:20px;font-weight:600;letter-spacing:-.012em}
.sub{margin:0 auto 24px;max-width:32ch;color:var(--mut);font-size:14.5px}
.dest{margin:0 auto 22px;max-width:32ch;color:var(--mut);font-size:13.5px}
.dest strong{display:block;margin-top:6px;font-size:15px;font-weight:600;color:var(--fg);word-break:break-all}
form{display:flex;flex-direction:column;gap:10px;text-align:left}
label{font-size:12.5px;font-weight:500;color:var(--mut)}
input{height:46px;width:100%;border:1px solid var(--bd);border-radius:11px;padding:0 14px;font-size:16px;color:inherit;background:transparent;outline:none;transition:border-color .12s,box-shadow .12s}
input:focus{border-color:var(--b);box-shadow:0 0 0 3px color-mix(in srgb,var(--b) 22%,transparent)}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:46px;width:100%;border:0;border-radius:11px;padding:0 20px;background:var(--b);color:#fff;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;text-decoration:none;transition:filter .12s}
button:hover,.btn:hover{filter:brightness(1.07)}
button:active,.btn:active{filter:brightness(.96)}
.err{margin:0;color:#dc2626;font-size:13px}
@media(prefers-color-scheme:dark){.err{color:#f87171}}
.foot{margin:26px 0 0;color:var(--faint);font-size:12px;font-weight:500}
.foot a{color:inherit;text-decoration:underline;text-underline-offset:2px}
</style></head><body><main class="card"><div class="mark">${logo}</div>${code}<h1>${htmlEsc(o.heading)}</h1><p class="sub">${htmlEsc(o.sub)}</p>${o.body}<p class="foot">${app}${support}</p></main></body></html>`;
}

export function passwordPageHtml(
  cfg: BrandBits,
  copy: BrandCopy,
  slug: string,
  error?: string,
): string {
  const c = copy.password;
  const err = error ? `<p class="err">${htmlEsc(error)}</p>` : "";
  return renderShell(cfg, {
    title: c.heading,
    heading: c.heading,
    sub: c.sub,
    support: copy.support,
    body: `<form method="POST" action="/api/unlock/${htmlEsc(slug)}"><label for="p">${htmlEsc(c.label)}</label><input id="p" type="password" name="password" placeholder="${htmlEsc(c.label)}" autofocus required autocomplete="off">${err}<button type="submit">${htmlEsc(c.button)}</button></form>`,
  });
}

export type LinkErrorKind = "not-found" | "expired" | "disabled" | "rate-limited" | "error";

/** Structural HTTP code + status per kind — the editable headings/subs come from
 *  BrandCopy.errors, not from here. */
export const LINK_ERRORS: Record<LinkErrorKind, { code: string; status: 404 | 410 | 429 | 500 }> = {
  "not-found": { code: "404", status: 404 },
  expired: { code: "410", status: 410 },
  disabled: { code: "410", status: 410 },
  "rate-limited": { code: "429", status: 429 },
  error: { code: "500", status: 500 },
};

export function linkErrorHtml(cfg: BrandBits, copy: BrandCopy, kind: LinkErrorKind): string {
  const e = LINK_ERRORS[kind];
  const c = copy.errors[kind];
  return renderShell(cfg, {
    title: c.heading,
    code: e.code,
    heading: c.heading,
    sub: c.sub,
    support: copy.support,
    body: `<a class="btn" href="/">${htmlEsc(copy.homeCta)}</a>`,
  });
}

/** Optional link-safety interstitial: confirm before forwarding to an external
 *  site. `destHost` is the destination hostname (already extracted, escaped here).
 *  The Continue link re-requests the slug with ?go=1 to skip the gate. */
export function interstitialHtml(
  cfg: BrandBits,
  copy: BrandCopy,
  slug: string,
  destHost: string,
): string {
  const c = copy.interstitial;
  return renderShell(cfg, {
    title: c.heading,
    heading: c.heading,
    sub: c.sub,
    support: copy.support,
    body: `<p class="dest">${htmlEsc(c.leaving)}<strong>${htmlEsc(destHost)}</strong></p><a class="btn" href="/${htmlEsc(slug)}?go=1" rel="noreferrer noopener">${htmlEsc(c.continue)}</a>`,
  });
}
