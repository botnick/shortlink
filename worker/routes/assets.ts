import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../env";
import { assetUploadSchema } from "../lib/validators";
import { requireAuth } from "../middleware/auth";
import type { AssetDTO } from "@shared/types";

const route = new Hono<AppEnv>();
route.use("*", requireAuth);

const MAX_ASSETS = 30;
const ID_RE = /^[0-9a-f-]{36}$/i;

function decode(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

// LIST — the signed-in user's saved logos.
route.get("/", async (c) => {
  const prefix = `logos/${c.var.user!.id}/`;
  const listing = await c.env.LOGO_BUCKET.list({
    prefix,
    include: ["customMetadata"],
  });
  const assets: AssetDTO[] = listing.objects.map((o) => {
    const id = o.key.slice(prefix.length);
    return { id, name: o.customMetadata?.name ?? "", url: `/api/assets/${id}` };
  });
  return c.json({ assets });
});

// UPLOAD (base64 data URL → R2 object)
route.post("/", zValidator("json", assetUploadSchema), async (c) => {
  const user = c.var.user!;
  const prefix = `logos/${user.id}/`;
  const listing = await c.env.LOGO_BUCKET.list({ prefix });
  if (listing.objects.length >= MAX_ASSETS) {
    return c.json({ error: "You've reached the saved-logo limit" }, 409);
  }
  const { dataUrl, name } = c.req.valid("json");
  const dec = decode(dataUrl);
  if (!dec) return c.json({ error: "Invalid image" }, 400);

  const id = crypto.randomUUID();
  await c.env.LOGO_BUCKET.put(prefix + id, dec.bytes, {
    httpMetadata: { contentType: dec.mime },
    customMetadata: { name: name ?? "" },
  });
  const asset: AssetDTO = { id, name: name ?? "", url: `/api/assets/${id}` };
  return c.json({ asset }, 201);
});

// SERVE the image bytes (owner only — key is namespaced by user id).
route.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  const obj = await c.env.LOGO_BUCKET.get(`logos/${c.var.user!.id}/${id}`);
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=86400",
    },
  });
});

// DELETE
route.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  await c.env.LOGO_BUCKET.delete(`logos/${c.var.user!.id}/${id}`);
  return c.json({ ok: true });
});

export default route;
