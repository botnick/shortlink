import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Globe, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { DomainDTO, DomainListDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/CopyButton";

const HOST_RE = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;

/** Reduce a pasted value to a bare hostname (mirrors the server's domainSchema). */
function normalizeHost(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^\.+|\.+$/g, "");
}

function statusBadge(status: string) {
  if (status === "active")
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3.5" /> Live
      </Badge>
    );
  if (status === "verified")
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3.5" /> Verified
      </Badge>
    );
  return <Badge variant="muted">Needs setup</Badge>;
}

function RecordRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
      <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-sm" title={value}>
        {value}
      </code>
      {copy && <CopyButton value={value} />}
    </div>
  );
}

/** A DNS record shown as a clean three-row table (Type / Name / Value). */
function DnsRecord({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <RecordRow label="Type" value={type} />
      <RecordRow label="Name" value={name} copy />
      <RecordRow label="Value" value={value} copy />
    </div>
  );
}

function NoticeBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 border-t pt-4 text-sm text-muted-foreground">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
      <p>{children}</p>
    </div>
  );
}

function HowStep({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        {n}
      </span>
      <p className="mt-2.5 text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

export function Domains() {
  const [mode, setMode] = useState<"dns" | "saas">("dns");
  const [domains, setDomains] = useState<DomainDTO[] | null>(null);
  const [hostname, setHostname] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DomainListDTO>("/domains")
      .then((r) => {
        setMode(r.mode);
        setDomains(r.domains);
      })
      .catch(() => toast.error("Couldn't load domains"));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    const cleaned = normalizeHost(hostname);
    if (!HOST_RE.test(cleaned)) return;
    setAdding(true);
    try {
      const { domain } = await api.post<{ domain: DomainDTO }>("/domains", {
        hostname: cleaned,
      });
      setDomains((d) => [domain, ...(d ?? [])]);
      setHostname("");
      toast.success("Domain added — follow the steps to connect it");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't add domain");
    } finally {
      setAdding(false);
    }
  }

  async function check(d: DomainDTO) {
    setBusy(d.id);
    try {
      const { domain } = await api.post<{ domain: DomainDTO }>(`/domains/${d.id}/check`);
      setDomains((list) => (list ?? []).map((x) => (x.id === domain.id ? domain : x)));
      toast.success(
        domain.status === "active"
          ? "Domain is live!"
          : domain.status === "verified"
            ? "Domain verified!"
            : "Still waiting on DNS",
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Not ready yet");
    } finally {
      setBusy(null);
    }
  }

  async function remove(d: DomainDTO) {
    if (!window.confirm(`Remove ${d.hostname}?`)) return;
    setBusy(d.id);
    try {
      await api.delete(`/domains/${d.id}`);
      setDomains((list) => (list ?? []).filter((x) => x.id !== d.id));
      toast.success("Domain removed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  const cleanedHost = normalizeHost(hostname);
  const validHost =
    cleanedHost.length > 0 && cleanedHost.length <= 253 && HOST_RE.test(cleanedHost);
  const typed = hostname.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="display text-3xl">Custom domains</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Serve short links from a domain you own — like{" "}
          <span className="font-medium text-foreground">go.yourbrand.com/abc</span> — instead of
          the default one.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <HowStep n={1} title="Add your domain" desc="Enter a subdomain you own in the box below." />
        <HowStep
          n={2}
          title="Add one DNS record"
          desc={
            mode === "saas"
              ? "Paste the CNAME + TXT we give you into your domain's DNS."
              : "Paste the TXT record we give you into your domain's DNS."
          }
        />
        <HowStep
          n={3}
          title="It goes live"
          desc={
            mode === "saas"
              ? "Once it resolves, it connects with TLS automatically."
              : "Once verified, an admin connects it and your links work on it."
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="domain">Your domain</Label>
        <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Globe className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="domain"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="go.yourbrand.com"
              className="pl-9"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" disabled={adding || !validHost} className="sm:w-auto">
            {adding ? <Loader2 className="animate-spin" /> : <Plus />} Add domain
          </Button>
        </form>
        {typed && !validHost ? (
          <p className="text-xs text-destructive">
            Enter a valid domain like go.brand.com — no http:// or paths.
          </p>
        ) : validHost && cleanedHost !== hostname.trim().toLowerCase() ? (
          <p className="text-xs text-muted-foreground">
            Will be added as{" "}
            <span className="font-medium text-foreground">{cleanedHost}</span>.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            A domain or subdomain you control — we'll show the exact DNS record to add next.
          </p>
        )}
      </div>

      {domains === null ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : domains.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <Globe className="mx-auto size-7 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium">No custom domains yet</p>
          <p className="text-sm text-muted-foreground">Add one above to brand your short links.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => {
            const done = d.status === "active" || d.status === "verified";
            const loading = busy === d.id;
            return (
              <Card key={d.id}>
                <CardContent className="space-y-4 p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Globe className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-semibold">{d.hostname}</span>
                      {statusBadge(d.status)}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(d)}
                      disabled={loading}
                      aria-label="Remove domain"
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  {!done && d.records.length > 0 && (
                    <div className="space-y-3 border-t pt-4">
                      <p className="text-sm text-muted-foreground">
                        Add {d.records.length > 1 ? "these records" : "this record"} in your DNS
                        provider (Cloudflare, Namecheap, GoDaddy…), then check the connection.
                      </p>
                      {d.records.map((r, i) => (
                        <DnsRecord key={i} type={r.type} name={r.name} value={r.value} />
                      ))}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-0.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => check(d)}
                          disabled={loading}
                        >
                          <RefreshCw className={loading ? "animate-spin" : ""} /> Check connection
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          DNS can take a few minutes to propagate
                          {d.mode === "saas" ? " — TLS is issued automatically." : "."}
                        </span>
                      </div>
                    </div>
                  )}

                  {d.status === "verified" && d.mode === "dns" && (
                    <NoticeBox>
                      Ownership confirmed. An admin connects{" "}
                      <strong className="text-foreground">{d.hostname}</strong> and TLS is issued —
                      your links go live shortly after.
                    </NoticeBox>
                  )}

                  {d.status === "active" && (
                    <NoticeBox>
                      Live — your short links now work at{" "}
                      <strong className="text-foreground">{d.hostname}</strong>.
                    </NoticeBox>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
