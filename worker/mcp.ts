/**
 * Remote MCP server (Streamable HTTP, stateless) so AI agents can manage short
 * links. One endpoint — POST /mcp — speaking JSON-RPC per the MCP spec, with
 * the existing API keys as auth (`Authorization: Bearer sk_…`).
 *
 * Built for agent ergonomics:
 * - every tool that targets a link accepts an id, a slug, OR a full short URL;
 * - expiry can be relative ("30m", "12h", "7d") instead of an ISO timestamp;
 * - tags can be added/removed incrementally, not just replaced;
 * - results carry structuredContent (spec 2025-06-18) plus a text fallback;
 * - read-only/destructive annotations let clients auto-approve safe tools.
 *
 * Every call is dispatched back through the Worker's own /api/v1 routes, so
 * MCP inherits the public API's validation, per-key rate limits and the admin
 * kill-switches with zero duplicated logic.
 */
import type { AppContext } from "./env";
import { getDbHandle } from "./db";
import { getCachedPublicConfig } from "./lib/appconfig";
import { resolveApiKey } from "./lib/apikeys";
import type { LinkDTO } from "@shared/types";

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_VERSION = "1.1.0";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Dispatch = (req: Request) => Promise<Response>;

interface ToolCtx {
  dispatch: Dispatch;
  origin: string;
  auth: string;
  /** Host short links live on when no custom domain is chosen. */
  defaultHost: string;
}

// --- Tool catalogue -----------------------------------------------------------

const RANGE_ENUM = ["24h", "7d", "30d", "90d", "all"];

const LINK_REF = {
  type: "string",
  description:
    'The link — accepts its id, its slug (e.g. "promo"), or the full short URL (e.g. "https://go.brand.com/promo")',
};

const EXPIRES_IN = {
  type: "string",
  description:
    'Relative expiry like "30m", "12h", "7d", "4w" (minutes/hours/days/weeks). Alternative to expiresAt.',
};

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

const annotate = (
  title: string,
  opts: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean } = {},
) => ({
  title,
  readOnlyHint: opts.readOnly ?? false,
  destructiveHint: opts.destructive ?? false,
  idempotentHint: opts.idempotent ?? false,
  openWorldHint: false,
});

const TOOLS: ToolDef[] = [
  {
    name: "get_overview",
    title: "Account overview",
    description:
      "Snapshot of the account: projects (with link counts), usable custom domains, and the most recent links. A good first call to get oriented.",
    inputSchema: { type: "object", properties: {} },
    annotations: annotate("Account overview", { readOnly: true, idempotent: true }),
  },
  {
    name: "create_link",
    title: "Create link",
    description:
      "Create a short link; returns it with its final shortUrl and ready-to-use QR URLs. " +
      "Omit `slug` for a random back-half. `domain` must be one of the account's verified custom domains (see list_domains); omit for the default host.",
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "The http(s) URL to shorten" },
        slug: { type: "string", description: "Custom back-half (3–32 chars: letters, numbers, - or _)" },
        domain: { type: "string", description: "Custom domain hostname to host the back-half on" },
        tags: { type: "array", items: { type: "string" }, description: "Labels for organising (max 20)" },
        password: { type: "string", description: "Password-protect the link" },
        expiresAt: { type: "string", description: "ISO 8601 expiry timestamp" },
        expiresIn: EXPIRES_IN,
        iosUrl: { type: "string", description: "iOS visitors go here instead" },
        androidUrl: { type: "string", description: "Android visitors go here instead" },
        desktopUrl: { type: "string", description: "Desktop visitors go here instead" },
        projectId: { type: "string", description: "Project to file the link under (see list_projects)" },
      },
      required: ["destination"],
    },
    annotations: annotate("Create link"),
  },
  {
    name: "list_links",
    title: "List links",
    description:
      "List the account's short links, newest first (20 per page). `q` searches slugs, destinations and tags; `tag` filters exactly; pass `cursor` from a previous result for the next page.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search text (matches slug, destination and tags)" },
        tag: { type: "string", description: "Only links carrying exactly this tag" },
        projectId: { type: "string" },
        cursor: { type: "string", description: "nextCursor from the previous page" },
      },
    },
    annotations: annotate("List links", { readOnly: true, idempotent: true }),
  },
  {
    name: "get_link",
    title: "Get link",
    description: "Fetch one link with all its settings and QR URLs.",
    inputSchema: {
      type: "object",
      properties: { link: LINK_REF },
      required: ["link"],
    },
    annotations: annotate("Get link", { readOnly: true, idempotent: true }),
  },
  {
    name: "update_link",
    title: "Update link",
    description:
      "Update a link; only provided fields change. Changing `slug`/`domain` keeps the old short URL redirecting (retired to an alias). " +
      "`tags` replaces the whole set; `addTags`/`removeTags` adjust it incrementally. Set `password` to null to remove protection, `expiresAt` to null to never expire, `isActive` false to pause.",
    inputSchema: {
      type: "object",
      properties: {
        link: LINK_REF,
        destination: { type: "string" },
        slug: { type: "string", description: "New back-half" },
        domain: { type: ["string", "null"], description: "Custom domain hostname, or null for the default host" },
        tags: { type: "array", items: { type: "string" }, description: "Replace all tags" },
        addTags: { type: "array", items: { type: "string" }, description: "Add these tags" },
        removeTags: { type: "array", items: { type: "string" }, description: "Remove these tags" },
        isActive: { type: "boolean" },
        password: { type: ["string", "null"] },
        expiresAt: { type: ["string", "null"], description: "ISO 8601 expiry, or null to clear" },
        expiresIn: EXPIRES_IN,
        iosUrl: { type: ["string", "null"] },
        androidUrl: { type: ["string", "null"] },
        desktopUrl: { type: ["string", "null"] },
        projectId: { type: "string" },
      },
      required: ["link"],
    },
    annotations: annotate("Update link", { idempotent: true }),
  },
  {
    name: "delete_link",
    title: "Delete link",
    description: "Permanently delete a link and its analytics. This cannot be undone — prefer update_link with isActive=false to pause instead.",
    inputSchema: {
      type: "object",
      properties: { link: LINK_REF },
      required: ["link"],
    },
    annotations: annotate("Delete link", { destructive: true, idempotent: true }),
  },
  {
    name: "get_link_stats",
    title: "Link analytics",
    description:
      "Analytics for a link: totals, unique visitors, daily timeseries, top countries/referrers/devices/browsers/OS. Bot traffic is already filtered out.",
    inputSchema: {
      type: "object",
      properties: {
        link: LINK_REF,
        range: { type: "string", enum: RANGE_ENUM, description: "Time range (default 7d)" },
      },
      required: ["link"],
    },
    annotations: annotate("Link analytics", { readOnly: true, idempotent: true }),
  },
  {
    name: "get_link_activity",
    title: "Recent clicks",
    description: "The latest 20 human clicks on a link (time, country, browser, OS, device, referrer).",
    inputSchema: {
      type: "object",
      properties: { link: LINK_REF },
      required: ["link"],
    },
    annotations: annotate("Recent clicks", { readOnly: true, idempotent: true }),
  },
  {
    name: "list_domains",
    title: "List domains",
    description:
      "The account's custom domains and their status. Only `usable: true` domains can host back-halves.",
    inputSchema: { type: "object", properties: {} },
    annotations: annotate("List domains", { readOnly: true, idempotent: true }),
  },
  {
    name: "list_projects",
    title: "List projects",
    description: "The account's projects (link folders), with link counts and the default project.",
    inputSchema: { type: "object", properties: {} },
    annotations: annotate("List projects", { readOnly: true, idempotent: true }),
  },
  {
    name: "bulk_import",
    title: "Bulk import",
    description:
      "Create up to 500 links in one call. Each row is independent — failures are reported per row while the rest are created.",
    inputSchema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          maxItems: 500,
          items: {
            type: "object",
            properties: {
              destination: { type: "string" },
              slug: { type: "string" },
              domain: { type: "string", description: "Custom domain hostname (optional)" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["destination"],
          },
        },
      },
      required: ["rows"],
    },
    annotations: annotate("Bulk import"),
  },
  {
    name: "get_qr",
    title: "QR code",
    description:
      "QR code URLs for a link: a shareable QR page and a direct SVG image URL (both reflect the link's saved QR design).",
    inputSchema: {
      type: "object",
      properties: { link: LINK_REF },
      required: ["link"],
    },
    annotations: annotate("QR code", { readOnly: true, idempotent: true }),
  },
];

// --- API dispatch helpers ------------------------------------------------------

async function callApi(
  ctx: ToolCtx,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await ctx.dispatch(
    new Request(`${ctx.origin}${path}`, {
      method,
      headers: {
        authorization: ctx.auth,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      typeof json.error === "string" ? json.error : `Request failed (HTTP ${res.status})`,
    );
  }
  return json;
}

/** Trim a LinkDTO down to what an agent needs, with QR URLs included. */
function compactLink(l: LinkDTO): Record<string, unknown> {
  let qrOrigin = "";
  try {
    qrOrigin = new URL(l.shortUrl).origin;
  } catch {
    /* leave QR fields off if the URL is somehow malformed */
  }
  return {
    id: l.id,
    shortUrl: l.shortUrl,
    destination: l.destination,
    slug: l.slug,
    domain: l.domain,
    tags: l.tags,
    isActive: l.isActive,
    clickCount: l.clickCount,
    hasPassword: l.hasPassword,
    expiresAt: l.expiresAt,
    iosUrl: l.iosUrl,
    androidUrl: l.androidUrl,
    desktopUrl: l.desktopUrl,
    projectId: l.projectId,
    createdAt: l.createdAt,
    ...(qrOrigin
      ? {
          qrPage: `${qrOrigin}/qr/${l.slug}`,
          qrImageSvg: `${qrOrigin}/qr/${l.slug}.svg`,
        }
      : {}),
  };
}

/** Map a custom-domain hostname to its id (or null/undefined passthrough). */
async function resolveDomainArg(
  ctx: ToolCtx,
  domain: unknown,
): Promise<string | null | undefined> {
  if (domain === undefined) return undefined;
  if (domain === null || domain === "") return null;
  const data = await callApi(ctx, "GET", "/api/v1/domains");
  const domains = (data.domains ?? []) as { id: string; hostname: string; status: string }[];
  const wanted = String(domain).toLowerCase();
  if (wanted === ctx.defaultHost.toLowerCase()) return null; // default host, not a custom domain
  const hit = domains.find(
    (d) => d.hostname === wanted && (d.status === "verified" || d.status === "active"),
  );
  if (!hit) {
    const usable = domains
      .filter((d) => d.status === "verified" || d.status === "active")
      .map((d) => d.hostname);
    throw new Error(
      `Domain "${domain}" isn't a verified domain on this account. Usable: ${
        usable.length ? usable.join(", ") : "(none — add one in the dashboard)"
      }`,
    );
  }
  return hit.id;
}

/**
 * Resolve a link reference — id, slug, or full short URL — to its id.
 * Friendly errors: unknown refs say so; an ambiguous slug lists the candidates.
 */
async function resolveLinkRef(ctx: ToolCtx, ref: unknown): Promise<string> {
  const raw = String(ref ?? "").trim();
  if (!raw) throw new Error("Provide `link`: an id, a slug, or the full short URL");
  if (UUID_RE.test(raw)) return raw;

  let slug = raw;
  let host: string | undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.includes("/")) {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
      slug = u.pathname.replace(/^\/+|\/+$/g, "");
      host = u.host.toLowerCase();
    } catch {
      throw new Error(`"${raw}" isn't a valid link reference`);
    }
    if (!slug || slug.includes("/")) {
      throw new Error(`"${raw}" doesn't look like a short link (expected <host>/<slug>)`);
    }
  }

  const params = new URLSearchParams({ slug });
  if (host) {
    params.set("host", host === ctx.defaultHost.toLowerCase() ? "default" : host);
  }
  const data = await callApi(ctx, "GET", `/api/v1/links?${params}`);
  const matches = (data.links ?? []) as LinkDTO[];
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) {
    throw new Error(`No link found for "${raw}" — try list_links to browse`);
  }
  throw new Error(
    `"${slug}" exists on several domains — be specific: ${matches
      .map((m) => m.shortUrl)
      .join(", ")}`,
  );
}

/** Turn "30m" / "12h" / "7d" / "4w" into an ISO timestamp from now. */
function parseExpiresIn(value: unknown): string {
  const m = /^(\d{1,4})\s*([mhdw])$/i.exec(String(value ?? "").trim());
  if (!m) {
    throw new Error(
      `Invalid expiresIn "${value}" — use e.g. "30m", "12h", "7d" or "4w"`,
    );
  }
  const n = Number(m[1]);
  const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[
    m[2].toLowerCase() as "m" | "h" | "d" | "w"
  ];
  return new Date(Date.now() + n * unitMs).toISOString();
}

// --- Tool execution -------------------------------------------------------------

async function executeTool(
  ctx: ToolCtx,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_overview": {
      const [projects, domains, links] = await Promise.all([
        callApi(ctx, "GET", "/api/v1/projects"),
        callApi(ctx, "GET", "/api/v1/domains"),
        callApi(ctx, "GET", "/api/v1/links"),
      ]);
      const projectList = (projects.projects ?? []) as {
        id: string;
        name: string;
        linkCount: number;
        isDefault: boolean;
      }[];
      const domainList = (domains.domains ?? []) as {
        hostname: string;
        status: string;
      }[];
      const recent = ((links.links ?? []) as LinkDTO[]).slice(0, 5);
      return {
        totalLinks: projectList.reduce((n, p) => n + p.linkCount, 0),
        defaultHost: ctx.defaultHost,
        projects: projectList.map((p) => ({
          id: p.id,
          name: p.name,
          linkCount: p.linkCount,
          isDefault: p.isDefault,
        })),
        domains: domainList.map((d) => ({
          hostname: d.hostname,
          status: d.status,
          usable: d.status === "verified" || d.status === "active",
        })),
        recentLinks: recent.map(compactLink),
      };
    }
    case "create_link": {
      const domainId = await resolveDomainArg(ctx, args.domain);
      const body: Record<string, unknown> = { destination: args.destination };
      for (const k of [
        "slug",
        "tags",
        "password",
        "expiresAt",
        "iosUrl",
        "androidUrl",
        "desktopUrl",
        "projectId",
      ]) {
        if (args[k] !== undefined) body[k] = args[k];
      }
      if (args.expiresIn !== undefined) body.expiresAt = parseExpiresIn(args.expiresIn);
      if (domainId !== undefined) body.domainId = domainId;
      const r = await callApi(ctx, "POST", "/api/v1/links", body);
      return compactLink(r.link as LinkDTO);
    }
    case "list_links": {
      const params = new URLSearchParams();
      for (const k of ["q", "tag", "projectId", "cursor"] as const) {
        if (typeof args[k] === "string" && args[k]) params.set(k, args[k] as string);
      }
      const qs = params.size ? `?${params}` : "";
      const r = await callApi(ctx, "GET", `/api/v1/links${qs}`);
      return {
        links: ((r.links ?? []) as LinkDTO[]).map(compactLink),
        nextCursor: r.nextCursor ?? null,
      };
    }
    case "get_link": {
      const id = await resolveLinkRef(ctx, args.link);
      const r = await callApi(ctx, "GET", `/api/v1/links/${id}`);
      return compactLink(r.link as LinkDTO);
    }
    case "update_link": {
      const id = await resolveLinkRef(ctx, args.link);
      const domainId = await resolveDomainArg(ctx, args.domain);
      const body: Record<string, unknown> = {};
      for (const k of [
        "destination",
        "slug",
        "tags",
        "isActive",
        "password",
        "expiresAt",
        "iosUrl",
        "androidUrl",
        "desktopUrl",
        "projectId",
      ]) {
        if (args[k] !== undefined) body[k] = args[k];
      }
      if (args.expiresIn !== undefined) body.expiresAt = parseExpiresIn(args.expiresIn);
      if (domainId !== undefined) body.domainId = domainId;
      // Incremental tag edits: fetch the current set, then adjust.
      const addTags = Array.isArray(args.addTags) ? (args.addTags as string[]) : [];
      const removeTags = Array.isArray(args.removeTags)
        ? (args.removeTags as string[])
        : [];
      if (addTags.length || removeTags.length) {
        const baseTags = Array.isArray(body.tags)
          ? (body.tags as string[])
          : (((await callApi(ctx, "GET", `/api/v1/links/${id}`)).link as LinkDTO)
              .tags ?? []);
        const next = new Set(baseTags);
        for (const t of addTags) next.add(t);
        for (const t of removeTags) next.delete(t);
        body.tags = [...next];
      }
      if (Object.keys(body).length === 0) throw new Error("No fields to update");
      const r = await callApi(ctx, "PATCH", `/api/v1/links/${id}`, body);
      return compactLink(r.link as LinkDTO);
    }
    case "delete_link": {
      const id = await resolveLinkRef(ctx, args.link);
      await callApi(ctx, "DELETE", `/api/v1/links/${id}`);
      return { ok: true, deleted: id };
    }
    case "get_link_stats": {
      const id = await resolveLinkRef(ctx, args.link);
      const range = RANGE_ENUM.includes(String(args.range)) ? args.range : "7d";
      return callApi(ctx, "GET", `/api/v1/links/${id}/stats?range=${range}`);
    }
    case "get_link_activity": {
      const id = await resolveLinkRef(ctx, args.link);
      return callApi(ctx, "GET", `/api/v1/links/${id}/activity`);
    }
    case "list_domains": {
      const r = await callApi(ctx, "GET", "/api/v1/domains");
      const domains = (r.domains ?? []) as {
        id: string;
        hostname: string;
        status: string;
      }[];
      return {
        defaultHost: ctx.defaultHost,
        domains: domains.map((d) => ({
          id: d.id,
          hostname: d.hostname,
          status: d.status,
          usable: d.status === "verified" || d.status === "active",
        })),
      };
    }
    case "list_projects":
      return callApi(ctx, "GET", "/api/v1/projects");
    case "bulk_import": {
      const rows = (Array.isArray(args.rows) ? args.rows : []) as Record<
        string,
        unknown
      >[];
      // Resolve each distinct hostname once, then swap it in per row.
      const hostnames = [
        ...new Set(
          rows
            .map((r) => r.domain)
            .filter((d): d is string => typeof d === "string" && d !== ""),
        ),
      ];
      const ids = new Map<string, string | null | undefined>();
      for (const h of hostnames) ids.set(h, await resolveDomainArg(ctx, h));
      const mapped = rows.map((r) => {
        const { domain, ...rest } = r;
        const domainId = typeof domain === "string" && domain ? ids.get(domain) : undefined;
        return domainId !== undefined && domainId !== null
          ? { ...rest, domainId }
          : rest;
      });
      const r = await callApi(ctx, "POST", "/api/v1/links/import", { rows: mapped });
      return {
        created: ((r.created ?? []) as LinkDTO[]).map(compactLink),
        errors: r.errors ?? [],
      };
    }
    case "get_qr": {
      const id = await resolveLinkRef(ctx, args.link);
      const r = await callApi(ctx, "GET", `/api/v1/links/${id}`);
      const link = r.link as LinkDTO;
      const origin = new URL(link.shortUrl).origin;
      return {
        qrPage: `${origin}/qr/${link.slug}`,
        qrImageSvg: `${origin}/qr/${link.slug}.svg`,
        shortUrl: link.shortUrl,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- JSON-RPC plumbing -----------------------------------------------------------

interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message },
});

const rpcResult = (id: RpcRequest["id"], result: unknown) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  result,
});

/** Handle one MCP HTTP request (stateless Streamable HTTP transport). */
export async function handleMcp(c: AppContext, dispatch: Dispatch): Promise<Response> {
  // DNS-rebinding defense: agents don't send Origin; browsers do — reject cross.
  const reqOrigin = c.req.header("origin");
  if (reqOrigin && reqOrigin !== new URL(c.req.url).origin) {
    return c.json({ error: "Cross-origin request blocked" }, 403);
  }
  if (c.req.method !== "POST") {
    return c.body(null, 405, { Allow: "POST" });
  }

  // Admin kill-switches: the public API master switch and the MCP toggle.
  const cfg = await getCachedPublicConfig(c.env);
  if (!cfg.apiEnabled || !cfg.mcpEnabled) {
    return c.json({ error: "The MCP server is currently disabled" }, 403);
  }

  // Authenticate the API key up front so a bad key fails at connect time, not
  // on the first tool call. (KV-cached, so this is cheap per request.)
  const auth = c.req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return c.json({ error: "Provide an API key: Authorization: Bearer sk_…" }, 401, {
      "WWW-Authenticate": "Bearer",
    });
  }
  {
    const { db, schema, close } = getDbHandle(c.env);
    try {
      const ok = await resolveApiKey(c.env, db, schema, auth.slice(7).trim());
      if (!ok) {
        return c.json({ error: "Invalid or revoked API key" }, 401, {
          "WWW-Authenticate": "Bearer",
        });
      }
    } finally {
      c.executionCtx.waitUntil(close());
    }
  }

  let rpc: RpcRequest;
  try {
    rpc = (await c.req.json()) as RpcRequest;
  } catch {
    return c.json(rpcError(null, -32700, "Parse error"));
  }
  if (Array.isArray(rpc)) {
    return c.json(rpcError(null, -32600, "Batch requests are not supported"));
  }

  // Notifications get acknowledged with 202 and no body.
  if (rpc.id === undefined && rpc.method?.startsWith("notifications/")) {
    return c.body(null, 202);
  }

  let defaultHost = "";
  try {
    defaultHost = new URL(cfg.appOrigin).host;
  } catch {
    defaultHost = "";
  }
  const ctx: ToolCtx = {
    dispatch,
    origin: new URL(c.req.url).origin,
    auth,
    defaultHost,
  };

  switch (rpc.method) {
    case "initialize": {
      const requested = String(rpc.params?.protocolVersion ?? "");
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOLS[0];
      return c.json(
        rpcResult(rpc.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: cfg.appName, version: SERVER_VERSION },
          instructions:
            `Short-link manager for ${cfg.appOrigin}. ` +
            "Start with get_overview to see projects, domains and recent links. " +
            "Tools that take `link` accept an id, a slug, or the full short URL. " +
            'Expiry accepts relative values via expiresIn ("30m", "12h", "7d"). ' +
            "Old back-halves keep redirecting after a slug/domain change.",
        }),
      );
    }
    case "ping":
      return c.json(rpcResult(rpc.id, {}));
    case "tools/list":
      return c.json(rpcResult(rpc.id, { tools: TOOLS }));
    case "resources/list":
      return c.json(rpcResult(rpc.id, { resources: [] }));
    case "prompts/list":
      return c.json(rpcResult(rpc.id, { prompts: [] }));
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await executeTool(ctx, name, args);
        return c.json(
          rpcResult(rpc.id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          }),
        );
      } catch (e) {
        return c.json(
          rpcResult(rpc.id, {
            content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
            isError: true,
          }),
        );
      }
    }
    default:
      return c.json(rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`));
  }
}
