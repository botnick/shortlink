import { useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ExternalLink,
  MousePointerClick,
  QrCode,
  Share2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { shortUrlFor } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/format";
import type { LinkDTO, NameCount, StatsDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { BackLink } from "@/components/BackLink";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/CopyButton";

const BRAND = "var(--color-primary)";
type Range = "24h" | "7d" | "30d" | "90d" | "all";
type Tab = "overview" | "location" | "sources" | "share";
const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "location", label: "Location" },
  { value: "sources", label: "Sources" },
  { value: "share", label: "Share" },
];

function Flag({ code }: { code: string }) {
  if (!/^[A-Za-z]{2}$/.test(code)) {
    return <span className="inline-block h-[15px] w-5 rounded-[2px] bg-muted" />;
  }
  const cc = code.toLowerCase();
  return (
    <img
      src={`https://flagcdn.com/20x15/${cc}.png`}
      srcSet={`https://flagcdn.com/40x30/${cc}.png 2x`}
      width={20}
      height={15}
      alt={code}
      loading="lazy"
      className="rounded-[2px]"
    />
  );
}

export function LinkStats() {
  const { id } = useParams<{ id: string }>();
  const [link, setLink] = useState<LinkDTO | null>(null);
  const [stats, setStats] = useState<StatsDTO | null>(null);
  const [range, setRange] = useState<Range>("7d");
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .get<{ link: LinkDTO }>(`/links/${id}`)
      .then((r) => setLink(r.link))
      .catch(() => setNotFound(true));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    api
      .get<StatsDTO>(`/links/${id}/stats?range=${range}`)
      .then(setStats)
      .catch(() => toast.error("Couldn't load analytics"))
      .finally(() => setLoading(false));
  }, [id, range]);

  if (notFound) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Link not found.</p>
        <Button asChild variant="outline" className="mt-4">
          <RouterLink to="/dashboard">Back to dashboard</RouterLink>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink to="/dashboard" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="display truncate text-2xl sm:text-3xl">
            {link?.title || (link ? `/${link.slug}` : "Analytics")}
          </h1>
          {link && (
            <a
              href={link.destination}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm text-muted-foreground hover:text-foreground"
            >
              {link.destination}
            </a>
          )}
        </div>
        {link && (
          <div className="flex items-center gap-2">
            <CopyButton value={shortUrlFor(link.slug)} label="Copy" variant="outline" />
            <Button asChild variant="outline" size="icon">
              <a href={shortUrlFor(link.slug)} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          </div>
        )}
      </div>

      {/* tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={
              tab === t.value
                ? "flex-1 whitespace-nowrap rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground"
                : "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* range (hidden on Share) */}
      {tab !== "share" && (
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <Button
              key={r.value}
              size="sm"
              variant={range === r.value ? "default" : "outline"}
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      )}

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={<MousePointerClick className="size-4" />}
              label="Total clicks"
              value={stats?.totalClicks}
              loading={loading}
            />
            <StatCard
              icon={<Users className="size-4" />}
              label="Unique visitors"
              value={stats?.uniqueVisitors}
              loading={loading}
            />
          </div>

          {stats && <ClickCount stats={stats} />}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Clicks over time</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : stats && stats.timeseries.length > 0 ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.timeseries} margin={{ left: -18, right: 8, top: 8 }}>
                      <defs>
                        <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={BRAND} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} width={36} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ stroke: "var(--border)" }} contentStyle={tooltipStyle} />
                      <Area type="monotone" dataKey="count" name="Clicks" stroke={BRAND} strokeWidth={2} fill="url(#clicksFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "location" && (
        <CountryList items={stats?.countries} loading={loading} />
      )}

      {tab === "sources" && (
        <div className="space-y-4">
          {stats && <SourceSplit stats={stats} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <BarList title="Referrers" items={stats?.referrers} loading={loading} />
            <BarList title="Devices" items={stats?.devices} loading={loading} />
            <BarList title="Browsers" items={stats?.browsers} loading={loading} />
            <BarList title="Operating systems" items={stats?.os} loading={loading} />
          </div>
        </div>
      )}

      {tab === "share" && link && <Share link={link} />}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
} as const;

function Empty() {
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">
      No data in this period yet.
    </p>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          {loading || value === undefined ? (
            <Skeleton className="mt-1 h-7 w-16" />
          ) : (
            <div className="text-2xl font-bold tabular-nums">{formatNumber(value)}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ClickCount({ stats }: { stats: StatsDTO }) {
  const rows = [
    { label: "Last 24 hours", value: stats.windows.last24h, rate: `${(stats.windows.last24h / 24).toFixed(1)}/hr` },
    { label: "Last 7 days", value: stats.windows.last7d, rate: `${(stats.windows.last7d / 7).toFixed(1)}/day` },
    { label: "Last 30 days", value: stats.windows.last30d, rate: `${(stats.windows.last30d / 30).toFixed(1)}/day` },
    { label: "All time", value: stats.windows.allTime, rate: "" },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Click count</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Created {formatDate(stats.createdAt)}
          {stats.bestDay
            ? ` · Best day ${formatDate(stats.bestDay.day)} (${formatNumber(stats.bestDay.count)})`
            : ""}
        </p>
        <div className="divide-y rounded-lg border">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="flex items-center gap-3">
                <span className="font-semibold tabular-nums">{formatNumber(r.value)}</span>
                <span className="w-16 text-right font-mono text-xs text-muted-foreground">{r.rate}</span>
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SourceSplit({ stats }: { stats: StatsDTO }) {
  const total = stats.directClicks + stats.referrerClicks;
  const data = [
    { name: "Referrer", value: stats.referrerClicks, color: "var(--color-primary)" },
    { name: "Direct", value: stats.directClicks, color: "var(--color-muted-foreground)" },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Direct vs referrer</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <Empty />
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
            <div className="h-40 w-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" innerRadius={42} outerRadius={70} strokeWidth={0}>
                    {data.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {data.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <span className="size-3 rounded-sm" style={{ backgroundColor: d.color }} />
                  <span className="w-20 text-muted-foreground">{d.name}</span>
                  <span className="font-semibold tabular-nums">{formatNumber(d.value)}</span>
                  <span className="text-xs text-muted-foreground">
                    {Math.round((d.value / total) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CountryList({
  items,
  loading,
}: {
  items: NameCount[] | undefined;
  loading: boolean;
}) {
  const max = Math.max(1, ...(items?.map((i) => i.count) ?? [0]));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top countries</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
        ) : items && items.length > 0 ? (
          items.map((item) => (
            <div key={item.name} className="relative overflow-hidden rounded">
              <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${(item.count / max) * 100}%` }} />
              <div className="relative flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span className="flex items-center gap-2 truncate">
                  <Flag code={item.name} />
                  {item.name}
                </span>
                <span className="font-medium tabular-nums">{formatNumber(item.count)}</span>
              </div>
            </div>
          ))
        ) : (
          <Empty />
        )}
      </CardContent>
    </Card>
  );
}

function BarList({
  title,
  items,
  loading,
}: {
  title: string;
  items: NameCount[] | undefined;
  loading: boolean;
}) {
  const max = Math.max(1, ...(items?.map((i) => i.count) ?? [0]));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)
        ) : items && items.length > 0 ? (
          items.map((item) => (
            <div key={item.name} className="relative overflow-hidden rounded">
              <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${(item.count / max) * 100}%` }} />
              <div className="relative flex items-center justify-between px-2 py-1 text-sm">
                <span className="truncate">{item.name}</span>
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

function Share({ link }: { link: LinkDTO }) {
  const shortUrl = shortUrlFor(link.slug);
  const text = link.title || link.slug;
  const shares = [
    {
      label: "X",
      href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shortUrl)}&text=${encodeURIComponent(text)}`,
    },
    {
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shortUrl)}`,
    },
    {
      label: "LINE",
      href: `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shortUrl)}`,
    },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Share this link</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
          <span className="flex-1 truncate pl-1 text-sm">{shortUrl}</span>
          <CopyButton value={shortUrl} label="Copy" variant="secondary" />
        </div>
        <div className="flex flex-wrap gap-2">
          {shares.map((s) => (
            <Button key={s.label} asChild variant="outline">
              <a href={s.href} target="_blank" rel="noreferrer">
                <Share2 /> {s.label}
              </a>
            </Button>
          ))}
          <Button asChild variant="outline">
            <RouterLink to={`/links/${link.id}/qr`}>
              <QrCode /> QR code
            </RouterLink>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
