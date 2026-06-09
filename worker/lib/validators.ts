import { z } from "zod";
import { DEFAULT_BRAND_COLOR } from "@shared/defaults";

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

export const registerSchema = z.object({
  email: emailField,
  password: passwordField,
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
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
  title: z.string().trim().max(120).optional(),
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
  title: z.string().trim().max(120).nullable().optional(),
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
