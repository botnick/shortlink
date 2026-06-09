import { useEffect, useState, type FormEvent } from "react";
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
  if (status === "active") return <Badge variant="success"><CheckCircle2 className="size-3.5" /> Live</Badge>;
  if (status === "verified") return <Badge variant="success"><CheckCircle2 className="size-3.5" /> Verified</Badge>;
  return <Badge variant="muted">Pending</Badge>;
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
      .then((r) => { setMode(r.mode); setDomains(r.domains); })
      .catch(() => toast.error("Couldn't load domains"));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!hostname.trim()) return;
    setAdding(true);
    try {
      const { domain } = await api.post<{ domain: DomainDTO }>("/domains", { hostname: hostname.trim() });
      setDomains((d) => [domain, ...(d ?? [])]);
      setHostname("");
      toast.success("Domain added — add the DNS record(s) below");
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
        domain.status === "active" ? "Domain is live!" :
        domain.status === "verified" ? "Domain verified!" : "Still waiting on DNS",
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
      <div>
        <h1 className="display text-3xl">Custom domains</h1>
        <p className="text-sm text-muted-foreground">
          Serve your short links from your own domain, e.g.{" "}
          <span className="font-medium">go.yourbrand.com</span>.{" "}
          {mode === "saas"
            ? "Add the DNS record and it connects automatically with TLS."
            : "Verify ownership with a DNS record; an admin then connects it."}
        </p>
      </div>

      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Globe className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="go.yourbrand.com" className="pl-9" />
        </div>
        <Button type="submit" disabled={adding} className="sm:w-auto">
          {adding ? <Loader2 className="animate-spin" /> : <Plus />} Add domain
        </Button>
      </form>

      {domains === null ? (
        <Skeleton className="h-24 w-full" />
      ) : domains.length === 0 ? (
        <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          No custom domains yet.
        </p>
      ) : (
        <div className="space-y-4">
          {domains.map((d) => {
            const done = d.status === "active" || d.status === "verified";
            return (
              <Card key={d.id}>
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-semibold">{d.hostname}</span>
                      {statusBadge(d.status)}
                    </div>
                    <div className="flex items-center gap-2">
                      {d.status !== "active" && (
                        <Button variant="outline" size="sm" onClick={() => check(d)} disabled={busy === d.id}>
                          <RefreshCw className={busy === d.id ? "animate-spin" : ""} /> Check
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => remove(d)} disabled={busy === d.id} aria-label="Remove domain">
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  {!done && d.records.length > 0 && (
                    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">
                        Add {d.records.length > 1 ? "these records" : "this record"} at your DNS
                        provider, then press <strong>Check</strong>.
                        {d.mode === "saas" && " TLS is issued automatically once they resolve."}
                      </p>
                      {d.records.map((r, i) => (
                        <div key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
                          <Badge variant="secondary" className="w-14 justify-center">{r.type}</Badge>
                          <span className="truncate font-mono" title={r.name}>{r.name}</span>
                          <CopyButton value={r.name} />
                          <span />
                          <span className="truncate font-mono" title={r.value}>{r.value}</span>
                          <CopyButton value={r.value} />
                        </div>
                      ))}
                    </div>
                  )}

                  {d.status === "verified" && d.mode === "dns" && (
                    <p className="text-xs text-muted-foreground">
                      Ownership confirmed. An admin connects <strong>{d.hostname}</strong> (Workers
                      Custom Domain) and TLS is issued — then your links work on it.
                    </p>
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
