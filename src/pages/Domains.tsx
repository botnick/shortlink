import { useEffect, useState, type FormEvent } from "react";
import { Globe, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
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
  if (status === "active") return <Badge variant="success">Active</Badge>;
  if (status === "error" || status === "deleted")
    return <Badge variant="outline" className="text-destructive">Needs attention</Badge>;
  return <Badge variant="muted">Pending DNS</Badge>;
}

export function Domains() {
  const [data, setData] = useState<DomainListDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [hostname, setHostname] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DomainListDTO>("/domains")
      .then(setData)
      .catch(() => toast.error("Couldn't load domains"))
      .finally(() => setLoading(false));
  }, []);

  function setDomains(updater: (d: DomainDTO[]) => DomainDTO[]) {
    setData((prev) => (prev ? { ...prev, domains: updater(prev.domains) } : prev));
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!hostname.trim()) return;
    setAdding(true);
    try {
      const { domain } = await api.post<{ domain: DomainDTO }>("/domains", {
        hostname: hostname.trim(),
      });
      setDomains((d) => [domain, ...d]);
      setHostname("");
      toast.success("Domain added — now add the DNS records below");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't add domain");
    } finally {
      setAdding(false);
    }
  }

  async function refresh(d: DomainDTO) {
    setBusy(d.id);
    try {
      const { domain } = await api.post<{ domain: DomainDTO }>(`/domains/${d.id}/refresh`);
      setDomains((list) => list.map((x) => (x.id === domain.id ? domain : x)));
      toast.success(domain.status === "active" ? "Domain is live!" : "Still waiting on DNS");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Refresh failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(d: DomainDTO) {
    if (!window.confirm(`Remove ${d.hostname}?`)) return;
    setBusy(d.id);
    try {
      await api.delete(`/domains/${d.id}`);
      setDomains((list) => list.filter((x) => x.id !== d.id));
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
          Serve your short links from your own domain, e.g. <span className="font-medium">go.yourbrand.com</span>.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : !data?.enabled ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
            <Globe className="mt-0.5 size-5 shrink-0" />
            <p>
              Custom domains aren’t enabled on this server yet. An admin needs to configure
              Cloudflare for SaaS (a <code>CF_API_TOKEN</code> secret plus the{" "}
              <code>CF_ZONE_ID</code> and <code>CF_FALLBACK_HOST</code> vars).
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <form onSubmit={add} className="flex gap-2">
            <div className="relative flex-1">
              <Globe className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="go.yourbrand.com"
                className="pl-9"
              />
            </div>
            <Button type="submit" disabled={adding}>
              {adding ? <Loader2 className="animate-spin" /> : <Plus />} Add domain
            </Button>
          </form>

          {data.domains.length === 0 ? (
            <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
              No custom domains yet.
            </p>
          ) : (
            <div className="space-y-4">
              {data.domains.map((d) => (
                <Card key={d.id}>
                  <CardContent className="space-y-4 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{d.hostname}</span>
                        {statusBadge(d.status)}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => refresh(d)} disabled={busy === d.id}>
                          <RefreshCw className={busy === d.id ? "animate-spin" : ""} /> Check
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(d)} disabled={busy === d.id} aria-label="Remove domain">
                          <Trash2 />
                        </Button>
                      </div>
                    </div>

                    {d.status !== "active" && d.records.length > 0 && (
                      <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">
                          Add these records at your DNS provider, then press <strong>Check</strong>.
                          TLS is issued automatically once they’re verified.
                        </p>
                        <div className="space-y-1.5">
                          {d.records.map((r, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <Badge variant="secondary" className="w-14 justify-center">{r.type}</Badge>
                              <span className="w-28 shrink-0 truncate font-mono text-muted-foreground" title={r.name}>{r.name}</span>
                              <span className="flex-1 truncate font-mono" title={r.value}>{r.value}</span>
                              <CopyButton value={r.value} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
