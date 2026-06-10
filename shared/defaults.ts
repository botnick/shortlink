// Single source of truth for the handful of values that need a default *before*
// an admin has configured anything (first-run installer + pre-setup fallbacks).
// Everything else is read from admin settings / config at runtime — nothing
// brand-specific should be hardcoded anywhere but here.

import type { BrandCopy } from "./types";

export const DEFAULT_APP_NAME = "Shortlink";
export const DEFAULT_BRAND_COLOR = "#e5392e";
export const DEFAULT_OG_TEMPLATE = "minimal";
export const DEFAULT_OG_FONT = "ibm-plex-thai";

/** Default copy for every worker-served branded page. The renderers read from a
 *  resolved BrandCopy (admin override merged onto this) — never a literal. */
export const DEFAULT_BRAND_COPY: BrandCopy = {
  errors: {
    "not-found": {
      heading: "Link not found",
      sub: "There’s no link at this address. It may have been mistyped or removed.",
    },
    expired: {
      heading: "Link expired",
      sub: "This link has reached its expiry date and no longer works.",
    },
    disabled: {
      heading: "Link unavailable",
      sub: "This link has been turned off by its owner.",
    },
    "rate-limited": {
      heading: "Too many attempts",
      sub: "You’ve made too many requests in a short time. Please wait a moment and try again.",
    },
    error: {
      heading: "Something went wrong",
      sub: "We hit an unexpected error. Please try again in a moment.",
    },
  },
  password: {
    heading: "Protected link",
    sub: "This link is password protected. Enter the password to continue.",
    label: "Password",
    button: "Unlock link",
  },
  interstitial: {
    heading: "Check before you continue",
    sub: "This short link is taking you to an external website.",
    leaving: "You’re heading to",
    continue: "Continue",
  },
  homeCta: "Go to homepage",
  support: { label: "", url: "" },
};
