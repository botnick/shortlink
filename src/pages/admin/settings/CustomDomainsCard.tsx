import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import type { SettingsDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsCard } from "./SettingsCard";
import type { SettingsPatch } from "./useSettingsData";

export function CustomDomainsCard({
  settings,
  loading,
  patch,
}: {
  settings: SettingsDTO | null;
  loading: boolean;
  patch: SettingsPatch;
}) {
  return (
    <SettingsCard
      title="Custom domains"
      description={
        <>
          Optional. Add Cloudflare for SaaS credentials and members’ domains connect
          automatically (CNAME + TLS). Leave blank for free DNS-verify only.
        </>
      }
      loading={loading}
      skeleton={<Skeleton className="h-9 w-full" />}
    >
      {settings && <CustomDomainsForm initial={settings} patch={patch} />}
    </SettingsCard>
  );
}

function CustomDomainsForm({ initial, patch }: { initial: SettingsDTO; patch: SettingsPatch }) {
  const [cfToken, setCfToken] = useState("");
  const [cfZoneId, setCfZoneId] = useState(initial.cfZoneId);
  const [cfFallbackHost, setCfFallbackHost] = useState(initial.cfFallbackHost);
  const [maxCustomHostnames, setMaxCustomHostnames] = useState(initial.maxCustomHostnames);
  const [unverifiedDays, setUnverifiedDays] = useState(initial.domainUnverifiedDays);
  const [cfConfigured, setCfConfigured] = useState(initial.cfConfigured);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Partial<SettingsDTO & { cfApiToken: string }> = {
        cfZoneId,
        cfFallbackHost,
        maxCustomHostnames,
        domainUnverifiedDays: unverifiedDays,
      };
      if (cfToken.trim()) body.cfApiToken = cfToken.trim();
      // Custom-domain creds aren't part of the public config — skip its refresh.
      const updated = await patch(body, { refreshConfig: false });
      setCfConfigured(updated.cfConfigured);
      setCfToken("");
      toast.success("Custom domain settings saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cfToken">
          Cloudflare API token{" "}
          {cfConfigured && (
            <span className="font-normal text-emerald-600">· configured</span>
          )}
        </Label>
        <Input
          id="cfToken"
          type="password"
          value={cfToken}
          onChange={(e) => setCfToken(e.target.value)}
          placeholder={cfConfigured ? "•••••••• (leave blank to keep)" : "Token with SSL & Certificates: Edit"}
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cfZone">Zone ID</Label>
        <Input id="cfZone" value={cfZoneId} onChange={(e) => setCfZoneId(e.target.value)} placeholder="your Cloudflare zone id" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cfFallback">
          Fallback host{" "}
          <span className="font-normal text-muted-foreground">(optional — members CNAME to this)</span>
        </Label>
        <Input id="cfFallback" value={cfFallbackHost} onChange={(e) => setCfFallbackHost(e.target.value)} placeholder="defaults to this app's domain" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="maxCustomHostnames">Max custom hostnames (cost cap)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="maxCustomHostnames"
            type="number"
            min={0}
            max={100000}
            value={maxCustomHostnames}
            onChange={(e) =>
              setMaxCustomHostnames(Math.max(0, Math.floor(Number(e.target.value) || 0)))
            }
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">
            total SaaS hostnames (0 = unlimited)
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Cloudflare for SaaS includes 100 free custom hostnames, then bills per hostname.
          Adding a domain is blocked once this many exist. Default 95 (a safe buffer).
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="unverifiedDays">Auto-remove unverified domains</Label>
        <div className="flex items-center gap-2">
          <Input
            id="unverifiedDays"
            type="number"
            min={0}
            max={3650}
            value={unverifiedDays}
            onChange={(e) =>
              setUnverifiedDays(Math.max(0, Math.floor(Number(e.target.value) || 0)))
            }
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">
            days after they're added (0 = never)
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Members see a countdown on the domain before it's removed.
        </p>
      </div>
      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </form>
  );
}
