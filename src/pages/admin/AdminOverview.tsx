import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Database, Link2, MousePointerClick, ToggleLeft, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { AdminOverviewDTO } from "@shared/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const BRAND = "var(--color-primary)";

function Stat({
  icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: number | undefined;
  sub?: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{label}</div>
          {loading || value === undefined ? (
            <Skeleton className="mt-1 h-7 w-16" />
          ) : (
            <div className="text-2xl font-bold tabular-nums">{formatNumber(value)}</div>
          )}
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminOverview() {
  const [data, setData] = useState<AdminOverviewDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AdminOverviewDTO>("/admin/overview")
      .then(setData)
      .catch(() => toast.error("Couldn't load the overview"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Link2 className="size-5" />} label="Links" value={data?.totals.links} sub={data ? `${formatNumber(data.totals.activeLinks)} active` : undefined} loading={loading} />
        <Stat icon={<MousePointerClick className="size-5" />} label="Total clicks" value={data?.totals.clicks} loading={loading} />
        <Stat icon={<ToggleLeft className="size-5" />} label="Clicks (7d)" value={data?.clicks7d} sub={data ? `${formatNumber(data.newLinks7d)} new links` : undefined} loading={loading} />
        <Stat icon={<Users className="size-5" />} label="Members" value={data?.totals.users} loading={loading} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Clicks · last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-56 w-full" />
            ) : data && data.timeseries.length > 0 ? (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.timeseries} margin={{ left: -18, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="ovFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BRAND} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} width={36} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ stroke: "var(--border)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="count" name="Clicks" stroke={BRAND} strokeWidth={2} fill="url(#ovFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">No clicks yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)
            ) : data && data.topLinks.length > 0 ? (
              data.topLinks.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">/{l.slug}</div>
                    <div className="truncate text-xs text-muted-foreground">{l.ownerEmail}</div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{formatNumber(l.clickCount)}</span>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No links yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Database className="size-4" />
        Database:
        {loading || !data ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <Badge variant="secondary">
            {data.dbDriver === "sqlite" ? "Cloudflare D1" : "Postgres"}
          </Badge>
        )}
      </div>
    </div>
  );
}
