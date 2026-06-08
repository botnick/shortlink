import { z } from "zod";

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
const longText = z.string().max(400_000); // data URL or URL
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
  brandColor: brandColor.optional().default("#e5392e"),
  email: emailField,
  password: passwordField,
  registrationEnabled: z.boolean(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["user", "admin"]),
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
  })
  .refine((v) => Object.keys(v).length > 0, "No settings provided");

export const qrPresetSchema = z.object({
  name: z.string().trim().min(1).max(40),
  config: z
    .record(z.string(), z.unknown())
    .refine((c) => JSON.stringify(c).length < 600_000, "Preset is too large"),
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

export const createLinkSchema = z.object({
  destination: httpUrl,
  slug: slugField.optional(),
  title: z.string().trim().max(120).optional(),
  expiresAt: isoDate.optional(),
});

export const updateLinkSchema = z.object({
  destination: httpUrl.optional(),
  title: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional(),
  expiresAt: isoDate.nullable().optional(),
});
