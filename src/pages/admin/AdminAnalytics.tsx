import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { AdminAnalyticsDTO, NameCount } from "@shared/types";
import { Download, Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BRAND = "var(--color-primary)";
type Range = "24h" | "7d" | "30d" | "90d" | "all";
const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

function flag(code: string) {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  const cc = code.toLowerCase();
  return (
    <img src={`https://flagcdn.com/20x15/${cc}.png`} width={20} height={15} alt={code} loading="lazy" className="rounded-[2px]" />
  );
}

function BarList({ title, items, loading, withFlag }: { title: string; items: NameCount[] | undefined; loading: boolean; withFlag?: boolean }) {
  const max = Math.max(1, ...(items?.map((i) => i.count) ?? [0]));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)
        ) : items && items.length > 0 ? (
          items.map((item) => (
            <div key={item.name} className="relative overflow-hidden rounded">
              <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${(item.count / max) * 100}%` }} />
              <div className="relative flex items-center justify-between gap-2 px-2 py-1 text-sm">
                <span className="flex items-center gap-2 truncate">{withFlag && flag(item.name)} {item.name}</span>
                <span className="ml-2 font-medium tabular-nums">{formatNumber(item.count)}</span>
              </div>
            </div>
          ))
        ) : (
          <p className="py-2 text-sm text-muted-foreground">No data yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminAnalytics() {
  const [data, setData] = useState<AdminAnalyticsDTO | null>(null);
  const [range, setRange] = useState<Range>("7d");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<AdminAnalyticsDTO>(`/admin/analytics?range=${range}`)
      .then((d) => active && setData(d))
      .catch(() => active && toast.error("Couldn't load analytics"))
      .finally(() => {
        if (active) setLoading(false);
      });
    // Guard against out-of-order resolution on fast range toggles.
    return () => {
      active = false;
    };
  }, [range]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <Button key={r.value} size="sm" variant={range === r.value ? "default" : "outline"} onClick={() => setRange(r.value)}>{r.label}</Button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm"><Download /> Export</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={`/api/admin/export/clicks.csv?range=${range}`} download>
                <Sheet /> Clicks (CSV)
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="/api/admin/export/links.csv" download>
                <Sheet /> Links catalog (CSV)
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Total clicks</div>
            {loading || !data ? <Skeleton className="mt-1 h-7 w-20" /> : <div className="text-2xl font-bold tabular-nums">{formatNumber(data.totalClicks)}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Unique visitors</div>
            {loading || !data ? <Skeleton className="mt-1 h-7 w-20" /> : <div className="text-2xl font-bold tabular-nums">{formatNumber(data.uniqueVisitors)}</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Clicks over time</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-56 w-full" />
          ) : data && data.timeseries.length > 0 ? (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timeseries} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="anFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BRAND} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="day" tickFormatter={(d: string) => (data.granularity === "hour" ? d.slice(11, 16) : d.slice(5, 10))} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} width={36} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ stroke: "var(--border)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} labelFormatter={(d) => (data.granularity === "hour" ? String(d).replace("T", " ") : String(d))} />
                  <Area type="monotone" dataKey="count" name="Clicks" stroke={BRAND} strokeWidth={2} fill="url(#anFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">No clicks in this period.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <BarList title="Top countries" items={data?.countries} loading={loading} withFlag />
        <BarList title="Referrers" items={data?.referrers} loading={loading} />
        <BarList title="Devices" items={data?.devices} loading={loading} />
        <BarList title="Browsers" items={data?.browsers} loading={loading} />
        <BarList title="Operating systems" items={data?.os} loading={loading} />
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Busiest links <span className="font-normal text-muted-foreground">(all-time)</span></CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : data && data.topLinks.length > 0 ? (
              data.topLinks.map((l) => (
                <div key={l.slug} className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">/{l.slug}</div>
                    <div className="truncate text-xs text-muted-foreground">{l.ownerEmail}</div>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">{formatNumber(l.clickCount)}</span>
                </div>
              ))
            ) : (
              <p className="py-2 text-sm text-muted-foreground">No links yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
