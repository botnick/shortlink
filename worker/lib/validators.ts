import { z } from "zod";
import { DEFAULT_BRAND_COLOR } from "@shared/defaults";
import { POOL_GAME_TYPES } from "@shared/captcha";

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Destination must be a valid http(s) URL");

const slugField = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{3,32}$/, "3–32 characters: letters, numbers, - or _");

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

const emailField = z.string().trim().toLowerCase().email().max(254);
const passwordField = z.string().min(8, "Use at least 8 characters").max(200);
const appName = z.string().trim().min(1).max(40);
const shortDomain = z.string().trim().max(120);
const brandColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color");
// A data URL (uploaded image) or a plain URL. Images are downscaled in the
// browser before upload, so this is a safety ceiling, not the expected size —
// base64 inflates bytes ~1.37×, so keep generous headroom over the raw file.
const longText = z
  .string()
  .max(800_000, "Image is too large — please use a smaller file");
const description = z.string().trim().max(300);

// Human-check fields sent with sign-in and sign-up when the admin enables it:
// the one-time verification token minted by /api/captcha/verify, plus a
// honeypot field.
const challengeFields = {
  humanToken: z.string().max(200).optional(),
  // Honeypot — humans never fill this; bots that do are rejected generically.
  website: z.string().max(200).optional(),
};

export const registerSchema = z.object({
  email: emailField,
  password: passwordField,
  ...challengeFields,
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
  ...challengeFields,
});

export const setupSchema = z.object({
  token: z.string().min(1).max(500),
  appName,
  shortDomain: shortDomain.optional().default(""),
  brandColor: brandColor.optional().default(DEFAULT_BRAND_COLOR),
  email: emailField,
  password: passwordField,
  registrationEnabled: z.boolean(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["user", "admin"]),
});

export const createUserSchema = z.object({
  email: emailField,
  password: passwordField,
  role: z.enum(["user", "admin"]).optional().default("user"),
});

export const resetPasswordSchema = z.object({
  password: passwordField,
});

export const bulkLinksSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["pause", "activate", "delete"]),
});

export const settingsSchema = z
  .object({
    registrationEnabled: z.boolean().optional(),
    appName: appName.optional(),
    shortDomain: shortDomain.optional(),
    brandColor: brandColor.optional(),
    logoUrl: longText.optional(),
    description: description.optional(),
    ogImageUrl: longText.optional(),
    indexable: z.boolean().optional(),
    blockedDomains: z.array(z.string().trim().max(253)).max(1000).optional(),
    extraReserved: z.array(z.string().trim().max(64)).max(1000).optional(),
    maxLinksPerUser: z.number().int().min(0).max(10_000_000).optional(),
    authRateLimit: z.number().int().min(0).max(10_000).optional(),
    createRateLimit: z.number().int().min(0).max(100_000).optional(),
    maxDomainsPerUser: z.number().int().min(0).max(10_000).optional(),
    maxAliasesPerLink: z.number().int().min(0).max(1_000).optional(),
    apiEnabled: z.boolean().optional(),
    apiRateLimit: z.number().int().min(0).max(100_000).optional(),
    maxApiKeysPerUser: z.number().int().min(0).max(1_000).optional(),
    mcpEnabled: z.boolean().optional(),
    slugLength: z.number().int().min(3).max(32).optional(),
    accountHoldDays: z.number().int().min(0).max(3650).optional(),
    emailBlockDays: z.number().int().min(0).max(3650).optional(),
    powDifficulty: z.number().int().min(0).max(26).optional(),
    // v3 modes; "off"/"game" are the legacy v2 spellings, still accepted so
    // older clients/tests keep working (the getter maps them).
    challengeMode: z
      .enum(["disabled", "invisible", "game-only", "off", "game", "forced-game"])
      .optional(),
    // Pool of visual games the admin can enable. Bound to the shared
    // POOL_GAME_TYPES so it can never drift out of sync (it was missing
    // "slide", which rejected the default games list). key-count is excluded
    // by design — it's the keyboard-only fallback, not part of the rotation.
    captchaGames: z
      .array(z.enum(POOL_GAME_TYPES))
      .min(1)
      .max(POOL_GAME_TYPES.length)
      .optional(),
    captchaMinGames: z.number().int().min(1).max(3).optional(),
    captchaMaxGames: z.number().int().min(1).max(3).optional(),
    captchaChallengeTtl: z.number().int().min(30).max(600).optional(),
    captchaTokenTtl: z.number().int().min(60).max(900).optional(),
    captchaMaxRetries: z.number().int().min(1).max(10).optional(),
    captchaMaxEvents: z.number().int().min(50).max(1000).optional(),
    captchaRiskMedium: z.number().int().min(1).max(100).optional(),
    captchaRiskHigh: z.number().int().min(1).max(100).optional(),
    captchaTolerance: z.enum(["lenient", "standard", "strict"]).optional(),
    captchaCreateLimit: z.number().int().min(0).max(10_000).optional(),
    captchaVerifyLimit: z.number().int().min(0).max(10_000).optional(),
    captchaEnforce: z.boolean().optional(),
    cfApiToken: z.string().trim().max(200).optional(),
    cfZoneId: z.string().trim().max(64).optional(),
    cfFallbackHost: z.string().trim().max(253).optional(),
    domainUnverifiedDays: z.number().int().min(0).max(3650).optional(),
    ogTemplate: z
      .enum([
        "minimal",
        "dark",
        "brand",
        "split",
        "grid",
        "editorial",
        "glow",
        "sidebar",
        "footer",
        "frame",
        "card",
        "mono",
      ])
      .optional(),
    ogFont: z
      .enum([
        "ibm-plex-thai",
        "ibm-plex-thai-looped",
        "kanit",
        "noto-sans-thai",
        "sarabun",
      ])
      .optional(),
    ogLabel: z.string().trim().max(40).optional(),
    ogTitle: z.string().trim().max(120).optional(),
    ogTagline: z.string().trim().max(300).optional(),
    ogAccent: z
      .string()
      .trim()
      .regex(/^(#[0-9a-fA-F]{6})?$/, "Use a 6-digit hex color")
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No settings provided");

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the key a name").max(40),
});

// --- Human check v3 (interactive game CAPTCHA) --------------------------------

export const captchaChallengeSchema = z.object({
  action: z.enum(["login", "register"]),
  // Phase H: opt into the non-visual, keyboard-only accessible challenge.
  accessible: z.boolean().optional(),
});

// One compact interaction event. Coordinates are scene units (0–100, slack for
// edge overshoot); offsets are bounded by the longest possible challenge.
const captchaEventSchema = z.object({
  t: z.enum(["pointer-down", "pointer-move", "pointer-up", "key-down"]),
  x: z.number().min(-10).max(110).optional(),
  y: z.number().min(-10).max(110).optional(),
  targetId: z.string().max(16).optional(),
  offsetMs: z.number().min(0).max(600_000),
});

// Static ceiling of 1000 events — the admin-set per-challenge cap (default
// 300) is enforced in the service on top of this transport bound.
export const captchaVerifySchema = z.object({
  ref: z.string().regex(/^hc1_[0-9a-f]{64}$/),
  powSolution: z.string().max(64).optional(),
  gameId: z.string().max(16).optional(),
  answer: z.unknown().optional(),
  evidence: z
    .object({
      startedAtOffsetMs: z.number().min(0).max(600_000),
      completedAtOffsetMs: z.number().min(0).max(600_000),
      viewport: z.object({
        w: z.number().min(0).max(100_000),
        h: z.number().min(0).max(100_000),
        dpr: z.number().min(0).max(16),
      }),
      inputMode: z.enum(["mouse", "touch", "pen", "keyboard", "mixed"]),
      events: z.array(captchaEventSchema).max(1000),
      signals: z
        .object({
          webdriver: z.boolean().optional(),
          touch: z.boolean().optional(),
          softwareRender: z.boolean().optional(),
          headlessHints: z.number().int().min(0).max(20).optional(),
          pageDwellMs: z.number().min(0).max(86_400_000).optional(),
          interactedBefore: z.boolean().optional(),
          automationMarkers: z.number().int().min(0).max(50).optional(),
          untrusted: z.boolean().optional(),
          clientCanary: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

// --- Account self-service (all require the current password) ------------------

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordField,
});

export const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1).max(200),
});

export const qrPresetSchema = z.object({
  name: z.string().trim().min(1).max(40),
  config: z
    .record(z.string(), z.unknown())
    .refine((c) => JSON.stringify(c).length < 600_000, "Preset is too large"),
  projectId: z.string().uuid().optional(),
});

export const domainSchema = z.object({
  // Be forgiving: accept a pasted URL and reduce it to the bare hostname before
  // validating (strip scheme://, any path/query, a port, and stray dots).
  hostname: z
    .string()
    .trim()
    .transform((v) =>
      v
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/:\d+$/, "")
        .replace(/^\.+|\.+$/g, ""),
    )
    .refine(
      (v) => v.length <= 253 && /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(v),
      "Enter a valid domain like go.example.com",
    ),
});

export const assetUploadSchema = z.object({
  name: z.string().trim().max(60).optional(),
  dataUrl: z
    .string()
    .regex(
      /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/,
      "Must be a base64 image",
    )
    .max(800_000),
});

const previewMode = z.enum(["off", "custom", "destination"]);
const ogTitle = z.string().trim().max(120).nullable();
const ogDescription = z.string().trim().max(300).nullable();
const ogImage = longText.nullable();
// Per-OS deep-link target: an http(s) URL (universal/app link or store page),
// or null to clear. Custom URI schemes are intentionally rejected — they'd need
// a JS interstitial, which we avoid to keep the redirect clean and instant.
const deepLink = httpUrl.nullable();
// A link password: a non-empty string to set, or null to remove the gate.
const linkPassword = z.string().min(1, "Password can’t be empty").max(200).nullable();
// Saved QR design (a QrCfg object), or null to reset to the default.
const qrConfigField = z
  .record(z.string(), z.unknown())
  .refine((c) => JSON.stringify(c).length < 600_000, "QR design is too large")
  .nullable();

// Free-form labels: trimmed, de-duplicated, capped in count and length.
const tagsField = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .transform((arr) => [...new Set(arr.map((t) => t.trim()).filter(Boolean))]);

// The custom domain a link's back-half lives on, or null for the default host.
const linkDomainId = z.string().uuid().nullable();

export const createLinkSchema = z.object({
  destination: httpUrl,
  iosUrl: deepLink.optional(),
  androidUrl: deepLink.optional(),
  desktopUrl: deepLink.optional(),
  password: linkPassword.optional(),
  slug: slugField.optional(),
  domainId: linkDomainId.optional(),
  tags: tagsField.optional(),
  expiresAt: isoDate.optional(),
  previewMode: previewMode.optional(),
  ogTitle: ogTitle.optional(),
  ogDescription: ogDescription.optional(),
  ogImage: ogImage.optional(),
  projectId: z.string().uuid().optional(),
});

export const updateLinkSchema = z.object({
  destination: httpUrl.optional(),
  iosUrl: deepLink.optional(),
  androidUrl: deepLink.optional(),
  desktopUrl: deepLink.optional(),
  password: linkPassword.optional(),
  qrConfig: qrConfigField.optional(),
  // Editable back-half + domain. The previous (domain, slug) is retired to an
  // alias so old shared links keep redirecting.
  slug: slugField.optional(),
  domainId: linkDomainId.optional(),
  tags: tagsField.optional(),
  isActive: z.boolean().optional(),
  expiresAt: isoDate.nullable().optional(),
  previewMode: previewMode.optional(),
  ogTitle: ogTitle.optional(),
  ogDescription: ogDescription.optional(),
  ogImage: ogImage.optional(),
  projectId: z.string().uuid().optional(),
});

// Live availability check for the editor — slug within a chosen domain bucket.
export const slugCheckSchema = z.object({
  slug: z.string().trim(),
  domainId: linkDomainId.optional(),
});

// Bulk import: many links at once (capped). Each row is validated independently;
// invalid rows are reported back rather than failing the whole batch.
export const bulkImportSchema = z.object({
  rows: z
    .array(
      z.object({
        destination: httpUrl,
        slug: slugField.optional(),
        domainId: linkDomainId.optional(),
        tags: tagsField.optional(),
      }),
    )
    .min(1)
    .max(500),
});

const projectName = z.string().trim().min(1).max(60);
const projectColor = z.union([z.literal(""), brandColor]);

export const projectCreateSchema = z.object({
  name: projectName,
  color: projectColor.optional(),
  logo: longText.nullable().optional(),
  defaultDomainId: z.string().uuid().nullable().optional(),
});

export const projectUpdateSchema = z
  .object({
    name: projectName.optional(),
    color: projectColor.optional(),
    logo: longText.nullable().optional(),
    defaultDomainId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No changes provided");
