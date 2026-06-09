import type { SaasConfig } from "./settings";
import type { DomainDnsRecord } from "@shared/types";

const API = "https://api.cloudflare.com/client/v4";

export interface HostnameResult {
  cfId: string;
  status: string; // "active" | "pending" | ...
  records: DomainDnsRecord[];
}

async function cf(cfg: SaasConfig, path: string, init?: RequestInit) {
  const res = await fetch(`${API}/zones/${cfg.zoneId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.token}`,
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
    throw new Error(body?.errors?.[0]?.message ?? `Cloudflare API error (${res.status})`);
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
  ownership_verification?: { name?: string; value?: string };
}

function normalize(cfg: SaasConfig, r: CfHostname): HostnameResult {
  // The user CNAMEs their hostname at the fallback host; CF issues TLS once the
  // CNAME (and any validation TXT records) resolve.
  const records: DomainDnsRecord[] = [
    { type: "CNAME", name: "@", value: cfg.fallbackHost },
  ];
  const ov = r.ownership_verification;
  if (ov?.name && ov.value) records.push({ type: "TXT", name: ov.name, value: ov.value });
  for (const v of r.ssl?.validation_records ?? []) {
    if (v.txt_name && v.txt_value) records.push({ type: "TXT", name: v.txt_name, value: v.txt_value });
  }
  const active = r.status === "active" && r.ssl?.status === "active";
  return { cfId: r.id, status: active ? "active" : r.status ?? "pending", records };
}

export async function createCustomHostname(cfg: SaasConfig, hostname: string): Promise<HostnameResult> {
  const result = (await cf(cfg, "/custom_hostnames", {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.2" } },
    }),
  })) as CfHostname;
  return normalize(cfg, result);
}

export async function getCustomHostname(cfg: SaasConfig, cfId: string): Promise<HostnameResult> {
  return normalize(cfg, (await cf(cfg, `/custom_hostnames/${cfId}`)) as CfHostname);
}

export async function deleteCustomHostname(cfg: SaasConfig, cfId: string): Promise<void> {
  await cf(cfg, `/custom_hostnames/${cfId}`, { method: "DELETE" });
}
