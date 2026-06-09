import { CheckCircle2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useSearchList } from "@/lib/useSearchList";
import type { AdminDomainDTO, AdminDomainListDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ConfirmProvider";

export function AdminDomains() {
  const confirm = useConfirm();
  const list = useSearchList<AdminDomainDTO>(async ({ q, cursor }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    const r = await api.get<AdminDomainListDTO>(`/admin/domains?${params}`);
    return { items: r.domains, nextCursor: r.nextCursor, total: r.total };
  });

  async function check(d: AdminDomainDTO) {
    try {
      const { status } = await api.post<{ status: string }>(
        `/admin/domains/${d.id}/check`,
        {},
      );
      list.patchItem((x) => x.id === d.id, (x) => ({ ...x, status }));
      toast.success(
        status === "verified" || status === "active"
          ? "Domain verified"
          : `Still ${status}`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Check failed");
    }
  }

  async function remove(d: AdminDomainDTO) {
    if (
      !(await confirm({
        title: `Remove ${d.hostname}?`,
        description: `Owned by ${d.ownerEmail}.`,
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    try {
      await api.delete(`/admin/domains/${d.id}`);
      list.removeItem((x) => x.id === d.id);
      toast.success("Domain removed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={list.query}
            onChange={(e) => list.setQuery(e.target.value)}
            placeholder="Search hostname or owner…"
            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {list.total !== undefined && (
          <span className="text-sm text-muted-foreground">
            {list.total.toLocaleString()} domain{list.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Members add and verify ownership themselves. To make a verified domain live, connect
        it as a free <strong>Workers Custom Domain</strong> in Cloudflare (one step per domain).
      </p>

      {list.loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : list.items.length === 0 ? (
        <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">No domains yet.</p>
      ) : (
        <ul className="space-y-2">
          {list.items.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{d.hostname}</span>
                  {d.status === "active" ? (
                    <Badge variant="success"><CheckCircle2 className="size-3.5" /> Live</Badge>
                  ) : d.status === "verified" ? (
                    <Badge variant="success"><CheckCircle2 className="size-3.5" /> Verified</Badge>
                  ) : (
                    <Badge variant="muted">Pending</Badge>
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {d.ownerEmail} · added {formatDate(d.createdAt)}
                </div>
              </div>
              {d.status !== "active" && (
                <Button variant="outline" size="sm" onClick={() => check(d)}>
                  Check
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => remove(d)} aria-label="Remove domain"><Trash2 /></Button>
            </li>
          ))}
        </ul>
      )}

      {list.hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={list.loadMore} disabled={list.loadingMore}>
            {list.loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
