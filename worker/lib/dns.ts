import { randomHex } from "./encoding";

export const VERIFY_PREFIX = "_shortlink-verify";
export const VERIFY_TAG = "shortlink-verify";

export function newVerifyToken(): string {
  return randomHex(16);
}

export function verifyRecordName(hostname: string): string {
  return `${VERIFY_PREFIX}.${hostname}`;
}

export function verifyRecordValue(token: string): string {
  return `${VERIFY_TAG}=${token}`;
}

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

/**
 * Resolve TXT records for `name` via DNS-over-HTTPS (no Cloudflare API needed)
 * and check whether the expected `shortlink-verify=<token>` value is present.
 * Queries two public resolvers for resilience.
 */
export async function checkTxtVerification(
  hostname: string,
  token: string,
): Promise<boolean> {
  const name = verifyRecordName(hostname);
  const expected = verifyRecordValue(token);
  const resolvers = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`,
  ];

  for (const url of resolvers) {
    try {
      const res = await fetch(url, { headers: { accept: "application/dns-json" } });
      if (!res.ok) continue;
      const body = (await res.json()) as { Answer?: DohAnswer[] };
      const values = (body.Answer ?? [])
        .filter((a) => a.type === 16) // TXT
        .map((a) => a.data.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim());
      if (values.includes(expected)) return true;
    } catch {
      // try the next resolver
    }
  }
  return false;
}
