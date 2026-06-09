import type { AppBindings } from "../env";

const API = "https://api.cloudflare.com/client/v4";

export interface DnsRecord {
  type: "CNAME" | "TXT";
  name: string;
  value: string;
}

export interface HostnameResult {
  cfId: string;
  status: string; // "pending" | "active" | "error" | ...
  records: DnsRecord[];
}

export function customDomainsEnabled(env: AppBindings): boolean {
  return Boolean(env.CF_API_TOKEN && env.CF_ZONE_ID && env.CF_FALLBACK_HOST);
}

async function cf(env: AppBindings, path: string, init?: RequestInit) {
  const res = await fetch(`${API}/zones/${env.CF_ZONE_ID}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: unknown;
    errors?: { message: string }[];
  } | null;
  if (!res.ok || !body?.success) {
    const msg = body?.errors?.[0]?.message ?? `Cloudflare API error (${res.status})`;
    throw new Error(msg);
  }
  return body.result;
}

interface CfHostname {
  id: string;
  status?: string;
  ssl?: {
    status?: string;
    validation_records?: { txt_name?: string; txt_value?: string }[];
  };
  ownership_verification?: { type?: string; name?: string; value?: string };
}

/** Turn a Cloudflare custom_hostname result into our normalized shape. */
function normalize(env: AppBindings, r: CfHostname): HostnameResult {
  const records: DnsRecord[] = [
    { type: "CNAME", name: "@", value: env.CF_FALLBACK_HOST! },
  ];
  const ov = r.ownership_verification;
  if (ov?.name && ov.value) {
    records.push({ type: "TXT", name: ov.name, value: ov.value });
  }
  for (const v of r.ssl?.validation_records ?? []) {
    if (v.txt_name && v.txt_value) {
      records.push({ type: "TXT", name: v.txt_name, value: v.txt_value });
    }
  }
  const sslActive = r.ssl?.status === "active";
  const status = r.status === "active" && sslActive ? "active" : r.status ?? "pending";
  return { cfId: r.id, status, records };
}

export async function createCustomHostname(
  env: AppBindings,
  hostname: string,
): Promise<HostnameResult> {
  const result = (await cf(env, "/custom_hostnames", {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
    }),
  })) as CfHostname;
  return normalize(env, result);
}

export async function getCustomHostname(
  env: AppBindings,
  cfId: string,
): Promise<HostnameResult> {
  const result = (await cf(env, `/custom_hostnames/${cfId}`)) as CfHostname;
  return normalize(env, result);
}

export async function deleteCustomHostname(
  env: AppBindings,
  cfId: string,
): Promise<void> {
  await cf(env, `/custom_hostnames/${cfId}`, { method: "DELETE" });
}
