import type { AppContext } from "../env";
import { getCachedPublicConfig } from "./appconfig";
import {
  LINK_ERRORS,
  interstitialHtml,
  linkErrorHtml,
  passwordPageHtml,
  type LinkErrorKind,
} from "@shared/brandPages";

/**
 * Worker-facing wrappers around the pure brand-page renderers in
 * shared/brandPages.ts: resolve the cached public config (brand identity + the
 * admin-editable copy) and return a Response with the right status. `private,
 * no-store` everywhere — a link can be created, re-enabled or unlocked at any
 * moment, so never cache an interstitial/error.
 */

/**
 * A clean, no-JS unlock page for password-protected links. The form POSTs to
 * /api/unlock/:slug; the server 302s on the right password or re-renders this
 * page with an error — so it works under our strict CSP (no inline scripts).
 */
export async function passwordPage(
  c: AppContext,
  slug: string,
  error?: string,
): Promise<Response> {
  const cfg = await getCachedPublicConfig(c.env);
  return c.html(passwordPageHtml(cfg, cfg.brandCopy, slug, error), error ? 401 : 200, {
    "cache-control": "private, no-store",
  });
}

/** Branded 404/410/429/500 for the redirect path (replaces the bare SPA shell). */
export async function linkErrorPage(c: AppContext, kind: LinkErrorKind): Promise<Response> {
  const cfg = await getCachedPublicConfig(c.env);
  return c.html(linkErrorHtml(cfg, cfg.brandCopy, kind), LINK_ERRORS[kind].status, {
    "cache-control": "private, no-store",
  });
}

/** The optional link-safety interstitial shown before forwarding to `destHost`. */
export async function interstitialPage(
  c: AppContext,
  slug: string,
  destHost: string,
): Promise<Response> {
  const cfg = await getCachedPublicConfig(c.env);
  return c.html(interstitialHtml(cfg, cfg.brandCopy, slug, destHost), 200, {
    "cache-control": "private, no-store",
  });
}
