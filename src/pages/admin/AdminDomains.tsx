import { CheckCircle2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useSearchList } from "@/lib/useSearchList";
import type { AdminDomainDTO, AdminDomainListDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AdminDomains() {
  const list = useSearchList<AdminDomainDTO>(async ({ q, cursor }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    const r = await api.get<AdminDomainListDTO>(`/admin/domains?${params}`);
    return { items: r.domains, nextCursor: r.nextCursor, total: r.total };
  });

  async function remove(d: AdminDomainDTO) {
    if (!window.confirm(`Remove ${d.hostname} (owned by ${d.ownerEmail})?`)) return;
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

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Added</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No domains yet.</TableCell></TableRow>
            ) : (
              list.items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.hostname}</TableCell>
                  <TableCell className="hidden max-w-[14rem] truncate text-muted-foreground md:table-cell">{d.ownerEmail}</TableCell>
                  <TableCell>
                    {d.status === "verified" ? (
                      <Badge variant="success"><CheckCircle2 className="size-3.5" /> Verified</Badge>
                    ) : (
                      <Badge variant="muted">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground lg:table-cell">{formatDate(d.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => remove(d)} aria-label="Remove domain"><Trash2 /></Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
