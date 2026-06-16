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
  Download,
  ExternalLink,
  FileJson,
  MousePointerClick,
  QrCode,
  Share2,
  Sheet,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDate, formatNumber, timeAgo } from "@/lib/format";
import type { ActivityDTO, ActivityItemDTO, LinkDTO, NameCount, StatsDTO } from "@shared/types";
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
  const [activity, setActivity] = useState<ActivityItemDTO[] | null>(null);

  useEffect(() => {
    let active = true;
    setNotFound(false);
    api
      .get<{ link: LinkDTO }>(`/links/${id}`)
      .then((r) => active && setLink(r.link))
      .catch(() => active && setNotFound(true));
    // Drop a stale response if `id` changed before it resolved.
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<StatsDTO>(`/links/${id}/stats?range=${range}`)
      .then((s) => active && setStats(s))
      .catch(() => active && toast.error("Couldn't load analytics"))
      .finally(() => {
        if (active) setLoading(false);
      });
    // Guard against out-of-order resolution on fast id/range switches.
    return () => {
      active = false;
    };
  }, [id, range]);

  // Live activity feed: poll every 30s while the Overview tab is visible.
  // (Kept off background tabs and at a 30s cadence so an open dashboard doesn't
  // quietly burn the Worker request budget — see the redirect-scale notes.)
  useEffect(() => {
    if (tab !== "overview") return;
    let active = true;
    const load = () => {
      if (document.hidden) return;
      api
        .get<ActivityDTO>(`/links/${id}/activity`)
        .then((r) => active && setActivity(r.items))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [id, tab]);

  // Summary export is built client-side from the stats already in memory — no
  // extra request. (Raw clicks go through the capped CSV endpoint instead.)
  function downloadSummary() {
    if (!stats || !link) return;
    const blob = new Blob([JSON.stringify(stats, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stats-${link.slug}-${range}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
            {link ? `/${link.slug}` : "Analytics"}
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
            <CopyButton value={link.shortUrl} label="Copy" variant="outline" className="min-h-11" />
            <Button asChild variant="outline" size="icon" className="size-11">
              <a
                href={link.shortUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open link"
                title="Open link"
              >
                <ExternalLink />
              </a>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-h-11" title="Export">
                  <Download /> <span className="hidden sm:inline">Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={`/api/links/${id}/clicks.csv?range=${range}`} download>
                    <Sheet /> Clicks (CSV)
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadSummary}>
                  <FileJson /> Summary (JSON)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                ? "flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-md bg-muted px-3 py-2.5 text-sm font-medium text-foreground"
                : "flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
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
              variant={range === r.value ? "default" : "outline"}
              onClick={() => setRange(r.value)}
              className="min-h-11 min-w-12"
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
                      <XAxis dataKey="day" tickFormatter={(d: string) => (stats.granularity === "hour" ? d.slice(11, 16) : d.slice(5, 10))} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} width={36} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ stroke: "var(--border)" }} contentStyle={tooltipStyle} labelFormatter={(d) => (stats.granularity === "hour" ? String(d).replace("T", " ") : String(d))} />
                      <Area type="monotone" dataKey="count" name="Clicks" stroke={BRAND} strokeWidth={2} fill="url(#clicksFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty />
              )}
            </CardContent>
          </Card>

          <RecentActivity items={activity} />
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
          {stats.botClicks > 0
            ? ` · ${formatNumber(stats.botClicks)} bot click${stats.botClicks === 1 ? "" : "s"} filtered out`
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

/** Live feed of the latest human clicks (auto-refreshes every 10s). */
function RecentActivity({ items }: { items: ActivityItemDTO[] | null }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Recent activity
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items === null ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No clicks yet — share the link and watch them appear here.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((a, i) => {
              let refHost = "";
              try {
                refHost = a.referrer ? new URL(a.referrer).hostname.replace(/^www\./, "") : "";
              } catch {
                refHost = a.referrer ?? "";
              }
              return (
                <li key={`${a.at}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                  {a.country ? (
                    <Flag code={a.country} />
                  ) : (
                    <span className="inline-block h-[15px] w-5 rounded-[2px] bg-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {[a.browser, a.os].filter(Boolean).join(" · ") || "Unknown device"}
                    {refHost && (
                      <span className="text-muted-foreground"> · from {refHost}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">
                    {a.deviceType ?? ""}
                  </span>
                  <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                    {timeAgo(a.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Share({ link }: { link: LinkDTO }) {
  const shortUrl = link.shortUrl;
  const text = link.slug;
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
