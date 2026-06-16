import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import type { SettingsDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "./SettingsCard";
import type { SettingsPatch } from "./useSettingsData";

const toLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function LimitsCard({
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
      title="Limits & safety"
      description="Guardrails applied when members create links."
      loading={loading}
    >
      {settings && <LimitsForm initial={settings} patch={patch} />}
    </SettingsCard>
  );
}

function LimitsForm({ initial, patch }: { initial: SettingsDTO; patch: SettingsPatch }) {
  const [blockedDomains, setBlockedDomains] = useState(initial.blockedDomains.join("\n"));
  const [extraReserved, setExtraReserved] = useState(initial.extraReserved.join("\n"));
  const [maxLinks, setMaxLinks] = useState(initial.maxLinksPerUser);
  const [authRateLimit, setAuthRateLimit] = useState(initial.authRateLimit);
  const [createRateLimit, setCreateRateLimit] = useState(initial.createRateLimit);
  const [maxDomains, setMaxDomains] = useState(initial.maxDomainsPerUser);
  const [maxAliases, setMaxAliases] = useState(initial.maxAliasesPerLink);
  const [apiEnabled, setApiEnabled] = useState(initial.apiEnabled ?? true);
  const [apiRateLimit, setApiRateLimit] = useState(initial.apiRateLimit ?? 120);
  const [maxApiKeys, setMaxApiKeys] = useState(initial.maxApiKeysPerUser ?? 10);
  const [mcpEnabled, setMcpEnabled] = useState(initial.mcpEnabled ?? true);
  const [slugLength, setSlugLength] = useState(initial.slugLength ?? 6);
  const [accountHoldDays, setAccountHoldDays] = useState(initial.accountHoldDays ?? 180);
  const [emailBlockDays, setEmailBlockDays] = useState(initial.emailBlockDays ?? 180);
  const [clicksRetentionDays, setClicksRetentionDays] = useState(initial.clicksRetentionDays ?? 0);
  const [exportMaxRows, setExportMaxRows] = useState(initial.exportMaxRows ?? 10000);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch({
        blockedDomains: toLines(blockedDomains),
        extraReserved: toLines(extraReserved),
        maxLinksPerUser: Math.max(0, Math.floor(maxLinks) || 0),
        authRateLimit: Math.max(0, Math.floor(authRateLimit) || 0),
        createRateLimit: Math.max(0, Math.floor(createRateLimit) || 0),
        maxDomainsPerUser: Math.max(0, Math.floor(maxDomains) || 0),
        maxAliasesPerLink: Math.max(0, Math.floor(maxAliases) || 0),
        apiEnabled,
        apiRateLimit: Math.max(0, Math.floor(apiRateLimit) || 0),
        maxApiKeysPerUser: Math.max(0, Math.floor(maxApiKeys) || 0),
        mcpEnabled,
        slugLength: Math.min(32, Math.max(3, Math.floor(slugLength) || 6)),
        accountHoldDays: Math.max(0, Math.floor(accountHoldDays) || 0),
        emailBlockDays: Math.max(0, Math.floor(emailBlockDays) || 0),
        clicksRetentionDays: Math.max(0, Math.floor(clicksRetentionDays) || 0),
        exportMaxRows: Math.max(0, Math.floor(exportMaxRows) || 0),
      });
      toast.success("Limits saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="blocked">
          Blocked destination domains{" "}
          <span className="font-normal text-muted-foreground">(one per line)</span>
        </Label>
        <textarea
          id="blocked"
          rows={3}
          value={blockedDomains}
          onChange={(e) => setBlockedDomains(e.target.value)}
          placeholder={"malware.example\nspam.test"}
          className="w-full rounded-lg border bg-transparent px-3 py-2 font-mono text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Links pointing to these domains (or their subdomains) are rejected.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reserved">
          Reserved aliases{" "}
          <span className="font-normal text-muted-foreground">(one per line)</span>
        </Label>
        <textarea
          id="reserved"
          rows={3}
          value={extraReserved}
          onChange={(e) => setExtraReserved(e.target.value)}
          placeholder={"pricing\nblog"}
          className="w-full rounded-lg border bg-transparent px-3 py-2 font-mono text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="maxLinks">
          Max links per member{" "}
          <span className="font-normal text-muted-foreground">(0 = unlimited)</span>
        </Label>
        <Input
          id="maxLinks"
          type="number"
          min={0}
          value={maxLinks}
          onChange={(e) => setMaxLinks(Number(e.target.value))}
          className="max-w-[12rem]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slugLength">
          Random back-half length{" "}
          <span className="font-normal text-muted-foreground">(3–32)</span>
        </Label>
        <Input
          id="slugLength"
          type="number"
          min={3}
          max={32}
          value={slugLength}
          onChange={(e) => setSlugLength(Number(e.target.value))}
          className="max-w-[12rem]"
        />
        <p className="text-[11px] text-muted-foreground">
          Used for auto-generated links (no custom back-half), imports and the
          editor’s “Shortest” suggestion.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        <p className="text-sm font-medium">Abuse limits</p>
        <p className="-mt-2 text-xs text-muted-foreground">
          Guardrails against spam and brute force. 0 turns a limit off.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="maxAliases">Back-half changes per link</Label>
            <Input
              id="maxAliases"
              type="number"
              min={0}
              value={maxAliases}
              onChange={(e) => setMaxAliases(Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Old back-halves keep working; this caps how many times one link
              can change.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxDomains">Custom domains per member</Label>
            <Input
              id="maxDomains"
              type="number"
              min={0}
              value={maxDomains}
              onChange={(e) => setMaxDomains(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="authRate">Login attempts / 15 min / IP</Label>
            <Input
              id="authRate"
              type="number"
              min={0}
              value={authRateLimit}
              onChange={(e) => setAuthRateLimit(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="createRate">New links / hour / member</Label>
            <Input
              id="createRate"
              type="number"
              min={0}
              value={createRateLimit}
              onChange={(e) => setCreateRateLimit(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="holdDays">Closed-account hold (days)</Label>
            <Input
              id="holdDays"
              type="number"
              min={0}
              value={accountHoldDays}
              onChange={(e) => setAccountHoldDays(Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Deleted accounts are kept (disabled) this long before being purged.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blockDays">Email re-signup block (days)</Label>
            <Input
              id="blockDays"
              type="number"
              min={0}
              value={emailBlockDays}
              onChange={(e) => setEmailBlockDays(Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Extra days after the purge before that email can register again.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clicksRetention">Click history retention (days)</Label>
            <Input
              id="clicksRetention"
              type="number"
              min={0}
              max={3650}
              value={clicksRetentionDays}
              onChange={(e) => setClicksRetentionDays(Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Purge raw click rows older than this (0 = keep forever). Per-link
              totals are kept regardless; only old breakdowns/timeline are trimmed.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exportMaxRows">Analytics export row cap</Label>
            <Input
              id="exportMaxRows"
              type="number"
              min={0}
              max={1000000}
              value={exportMaxRows}
              onChange={(e) => setExportMaxRows(Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Max rows one CSV export returns (0 = disable export). The 10,000
              default fits the Workers free CPU budget; raise it only on a paid plan.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Public API</p>
            <p className="text-xs text-muted-foreground">
              Programmatic access with bearer API keys (/api/v1).
            </p>
          </div>
          <Switch
            checked={apiEnabled}
            onCheckedChange={setApiEnabled}
            aria-label="Enable the public API"
          />
        </div>
        {apiEnabled && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="apiRate">Requests / minute / key</Label>
                <Input
                  id="apiRate"
                  type="number"
                  min={0}
                  value={apiRateLimit}
                  onChange={(e) => setApiRateLimit(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxKeys">API keys per member</Label>
                <Input
                  id="maxKeys"
                  type="number"
                  min={0}
                  value={maxApiKeys}
                  onChange={(e) => setMaxApiKeys(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <div>
                <p className="text-sm font-medium">MCP server</p>
                <p className="text-xs text-muted-foreground">
                  Lets AI agents (Claude, etc.) manage links at /mcp using API keys.
                </p>
              </div>
              <Switch
                checked={mcpEnabled}
                onCheckedChange={setMcpEnabled}
                aria-label="Enable the MCP server"
              />
            </div>
          </>
        )}
      </div>

      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </form>
  );
}
