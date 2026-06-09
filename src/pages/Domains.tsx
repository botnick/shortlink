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

export function Domains() {
  const [domains, setDomains] = useState<DomainDTO[] | null>(null);
  const [hostname, setHostname] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DomainListDTO>("/domains")
      .then((r) => setDomains(r.domains))
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
      toast.success("Domain added — add the TXT record below, then verify");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't add domain");
    } finally {
      setAdding(false);
    }
  }

  async function verify(d: DomainDTO) {
    setBusy(d.id);
    try {
      const { domain } = await api.post<{ domain: DomainDTO }>(`/domains/${d.id}/verify`);
      setDomains((list) => (list ?? []).map((x) => (x.id === domain.id ? domain : x)));
      toast.success("Domain verified!");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Not verified yet");
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
          <span className="font-medium">go.yourbrand.com</span>. Prove you own it with a DNS
          record; once verified, an admin connects it.
        </p>
      </div>

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

      {domains === null ? (
        <Skeleton className="h-24 w-full" />
      ) : domains.length === 0 ? (
        <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          No custom domains yet.
        </p>
      ) : (
        <div className="space-y-4">
          {domains.map((d) => {
            const verified = d.status === "verified";
            return (
              <Card key={d.id}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{d.hostname}</span>
                      {verified ? (
                        <Badge variant="success">
                          <CheckCircle2 className="size-3.5" /> Verified
                        </Badge>
                      ) : (
                        <Badge variant="muted">Pending</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!verified && (
                        <Button variant="outline" size="sm" onClick={() => verify(d)} disabled={busy === d.id}>
                          <RefreshCw className={busy === d.id ? "animate-spin" : ""} /> Verify
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => remove(d)} disabled={busy === d.id} aria-label="Remove domain">
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  {!verified ? (
                    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">
                        Add this <strong>TXT</strong> record at your DNS provider, then press
                        <strong> Verify</strong>:
                      </p>
                      <div className="grid gap-1.5 text-xs sm:grid-cols-[auto_1fr_auto] sm:items-center">
                        <Badge variant="secondary" className="w-fit">TXT name</Badge>
                        <span className="truncate font-mono" title={d.verifyName}>{d.verifyName}</span>
                        <CopyButton value={d.verifyName} />
                        <Badge variant="secondary" className="w-fit">TXT value</Badge>
                        <span className="truncate font-mono" title={d.verifyValue}>{d.verifyValue}</span>
                        <CopyButton value={d.verifyValue} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Ownership confirmed. An admin connects <strong>{d.hostname}</strong> to the
                      service (Cloudflare → Workers Custom Domain) and TLS is issued automatically —
                      then your short links work on it.
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
