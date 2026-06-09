import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Globe, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { DomainDTO, DomainListDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/CopyButton";

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

/** One labelled, copyable DNS value (Name / Value) — clearer than a packed row. */
function RecordValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-sm" title={value}>
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

function NoticeBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
      <p>{children}</p>
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
    if (!hostname.trim()) return;
    setAdding(true);
    try {
      const { domain } = await api.post<{ domain: DomainDTO }>("/domains", {
        hostname: hostname.trim(),
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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="display text-3xl">Custom domains</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Serve your short links from your own domain like{" "}
          <span className="font-medium text-foreground">go.yourbrand.com</span> instead of the
          default one. Add a domain below, point one DNS record at us, and you're set
          {mode === "saas" ? " — TLS is issued automatically." : "."}
        </p>
      </div>

      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Globe className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="go.yourbrand.com"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={adding} className="sm:w-auto">
          {adding ? <Loader2 className="animate-spin" /> : <Plus />} Add domain
        </Button>
      </form>

      {domains === null ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : domains.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <Globe className="mx-auto size-7 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium">No custom domains yet</p>
          <p className="text-sm text-muted-foreground">
            Add one above to brand your short links.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => {
            const done = d.status === "active" || d.status === "verified";
            const loading = busy === d.id;
            return (
              <Card key={d.id}>
                <CardContent className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
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
                    <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                      <Step
                        n={1}
                        title={`Add ${d.records.length > 1 ? "these DNS records" : "this DNS record"} at your domain provider`}
                      >
                        <p className="text-xs text-muted-foreground">
                          In your registrar's DNS settings (Cloudflare, Namecheap, GoDaddy…), create:
                        </p>
                        <div className="space-y-3">
                          {d.records.map((r, i) => (
                            <div key={i} className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="font-mono">
                                  {r.type}
                                </Badge>
                                <span className="text-xs text-muted-foreground">record</span>
                              </div>
                              <RecordValue label="Name" value={r.name} />
                              <RecordValue label="Value" value={r.value} />
                            </div>
                          ))}
                        </div>
                      </Step>

                      <Step n={2} title="Then check the connection">
                        <p className="text-xs text-muted-foreground">
                          DNS can take a few minutes to propagate.{" "}
                          {d.mode === "saas"
                            ? "TLS is issued automatically once it resolves."
                            : "We'll verify you own the domain."}
                        </p>
                        <Button variant="outline" size="sm" onClick={() => check(d)} disabled={loading}>
                          <RefreshCw className={loading ? "animate-spin" : ""} /> Check connection
                        </Button>
                      </Step>
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
