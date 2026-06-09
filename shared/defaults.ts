// Single source of truth for the handful of values that need a default *before*
// an admin has configured anything (first-run installer + pre-setup fallbacks).
// Everything else is read from admin settings / config at runtime — nothing
// brand-specific should be hardcoded anywhere but here.

export const DEFAULT_APP_NAME = "Shortlink";
export const DEFAULT_BRAND_COLOR = "#e5392e";
export const DEFAULT_OG_TEMPLATE = "minimal";
export const DEFAULT_OG_FONT = "ibm-plex-thai";
