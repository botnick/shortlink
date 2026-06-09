/**
 * Remote MCP server (Streamable HTTP, stateless) so AI agents can manage short
 * links. One endpoint — POST /mcp — speaking JSON-RPC per the MCP spec, with
 * the existing API keys as auth (`Authorization: Bearer sk_…`).
 *
 * Every tool call is dispatched back through the Worker's own /api/v1 routes,
 * so MCP inherits the public API's validation, per-key rate limits and the
 * admin kill-switches with zero duplicated logic.
 */
import type { AppContext } from "./env";
import { getDbHandle } from "./db";
import { getCachedPublicConfig } from "./lib/appconfig";
import { resolveApiKey } from "./lib/apikeys";
import type { LinkDTO } from "@shared/types";

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_VERSION = "1.0.0";

type Dispatch = (req: Request) => Promise<Response>;

interface ToolCtx {
  dispatch: Dispatch;
  origin: string;
  auth: string;
}

// --- Tool catalogue -----------------------------------------------------------

const RANGE_ENUM = ["24h", "7d", "30d", "90d", "all"];

const TOOLS = [
  {
    name: "create_link",
    description:
      "Create a short link. Returns the link including its final shortUrl. " +
      "Omit `slug` for a random back-half; `domain` must be one of the account's verified custom domains (see list_domains), omit for the default host.",
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "The http(s) URL to shorten" },
        slug: { type: "string", description: "Custom back-half (3–32 chars: letters, numbers, - or _)" },
        domain: { type: "string", description: "Custom domain hostname to host the back-half on" },
        tags: { type: "array", items: { type: "string" }, description: "Labels for organising (max 20)" },
        password: { type: "string", description: "Password-protect the link" },
        expiresAt: { type: "string", description: "ISO 8601 expiry; the link stops working after this" },
        iosUrl: { type: "string", description: "iOS visitors go here instead" },
        androidUrl: { type: "string", description: "Android visitors go here instead" },
        desktopUrl: { type: "string", description: "Desktop visitors go here instead" },
        projectId: { type: "string", description: "Project to file the link under (see list_projects)" },
      },
      required: ["destination"],
    },
  },
  {
    name: "list_links",
    description:
      "List the account's short links, newest first (20 per page). Filter with `q` (slug/destination search), `tag`, or `projectId`; pass `cursor` from a previous result for the next page.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search text" },
        tag: { type: "string", description: "Only links carrying this tag" },
        projectId: { type: "string" },
        cursor: { type: "string", description: "nextCursor from the previous page" },
      },
    },
  },
  {
    name: "get_link",
    description: "Fetch one link by id, including all its settings.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Link id" } },
      required: ["id"],
    },
  },
  {
    name: "update_link",
    description:
      "Update a link. Only provided fields change. Changing `slug`/`domain` keeps the old short URL redirecting (it's retired to an alias). Set `password` to null to remove protection; `isActive` false pauses the link.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        destination: { type: "string" },
        slug: { type: "string" },
        domain: { type: ["string", "null"], description: "Custom domain hostname, or null for the default host" },
        tags: { type: "array", items: { type: "string" } },
        isActive: { type: "boolean" },
        password: { type: ["string", "null"] },
        expiresAt: { type: ["string", "null"] },
        iosUrl: { type: ["string", "null"] },
        androidUrl: { type: ["string", "null"] },
        desktopUrl: { type: ["string", "null"] },
        projectId: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_link",
    description: "Permanently delete a link (and its analytics). This cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_link_stats",
    description:
      "Analytics for a link: totals, unique visitors, daily timeseries, top countries/referrers/devices/browsers/OS. Bot traffic is already filtered out.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        range: { type: "string", enum: RANGE_ENUM, description: "Time range (default 7d)" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_link_activity",
    description: "The latest 20 human clicks on a link (time, country, browser, OS, device, referrer).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_domains",
    description:
      "The account's custom domains and their status. Only `verified`/`active` domains can host back-halves.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_projects",
    description: "The account's projects (link folders), with link counts and the default project.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "bulk_import",
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
  },
  {
    name: "get_qr",
    description:
      "QR code URLs for a link: a shareable QR page and a direct SVG image URL (both reflect the link's saved QR design).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
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

/** Trim a LinkDTO down to what an agent actually needs (saves tokens). */
function compactLink(l: LinkDTO): Record<string, unknown> {
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
  const hit = domains.find(
    (d) =>
      d.hostname === String(domain).toLowerCase() &&
      (d.status === "verified" || d.status === "active"),
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

// --- Tool execution -------------------------------------------------------------

async function executeTool(
  ctx: ToolCtx,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
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
      const r = await callApi(ctx, "GET", `/api/v1/links/${args.id}`);
      return compactLink(r.link as LinkDTO);
    }
    case "update_link": {
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
      if (domainId !== undefined) body.domainId = domainId;
      if (Object.keys(body).length === 0) throw new Error("No fields to update");
      const r = await callApi(ctx, "PATCH", `/api/v1/links/${args.id}`, body);
      return compactLink(r.link as LinkDTO);
    }
    case "delete_link": {
      await callApi(ctx, "DELETE", `/api/v1/links/${args.id}`);
      return { ok: true, deleted: args.id };
    }
    case "get_link_stats": {
      const range = RANGE_ENUM.includes(String(args.range)) ? args.range : "7d";
      return callApi(ctx, "GET", `/api/v1/links/${args.id}/stats?range=${range}`);
    }
    case "get_link_activity":
      return callApi(ctx, "GET", `/api/v1/links/${args.id}/activity`);
    case "list_domains": {
      const r = await callApi(ctx, "GET", "/api/v1/domains");
      const domains = (r.domains ?? []) as {
        id: string;
        hostname: string;
        status: string;
      }[];
      return {
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
      const r = await callApi(ctx, "GET", `/api/v1/links/${args.id}`);
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

  const ctx: ToolCtx = {
    dispatch,
    origin: new URL(c.req.url).origin,
    auth,
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
            `Manage short links on ${ctx.origin}. Create, edit, organise and analyse ` +
            "links; list_domains shows which custom domains can host back-halves.",
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
