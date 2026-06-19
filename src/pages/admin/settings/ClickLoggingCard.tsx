import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsCard } from "./SettingsCard";
import type { SettingsDTO } from "@shared/types";
import type { SettingsPatch } from "./useSettingsData";

/** Click logging mode. "raw" (default) stores a row per click — exact, with
 *  unique visitors and a live feed. "rollup" batches counts through a Durable
 *  Object that flushes hourly aggregates, so a very high-traffic install stays
 *  under D1's daily write cap. Trade-offs in rollup mode: no unique-visitor
 *  counts, no live activity feed, hourly (not per-second) granularity. D1 only. */
export function ClickLoggingCard({
  settings,
  loading,
  patch,
}: {
  settings: SettingsDTO | null;
  loading: boolean;
  patch: SettingsPatch;
}) {
  const [saving, setSaving] = useState(false);
  const rollup = settings?.clickLoggingMode === "rollup";

  async function toggle(value: boolean) {
    setSaving(true);
    try {
      await patch({ clickLoggingMode: value ? "rollup" : "raw" }, { refreshConfig: false });
      toast.success(value ? "Rollup logging enabled" : "Raw logging enabled");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      title="Click logging"
      description="How clicks are recorded. Raw stores one row per click (exact, with unique visitors + live feed). Rollup aggregates hourly counts via a Durable Object to stay under D1 write limits at very high traffic — but drops unique counts, the live feed, and sub-hour detail. D1 only."
      loading={false}
    >
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="text-sm">
          {rollup ? "Rollup (aggregated) — built for scale" : "Raw (row per click) — default"}
        </span>
        {loading || !settings ? (
          <Skeleton className="h-5 w-9 rounded-full" />
        ) : (
          <Switch checked={rollup} disabled={saving} onCheckedChange={toggle} />
        )}
      </label>
      <p className="mt-3 text-xs text-muted-foreground">
        Switching modes doesn’t merge history — dashboards show whichever store is
        active, so pick this <span className="font-medium">before</span> heavy traffic
        accumulates. Best left on <span className="font-medium">Raw</span> unless you’re
        approaching D1’s daily write limit.
      </p>
    </SettingsCard>
  );
}
