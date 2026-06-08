import { Copy, ExternalLink, MoreHorizontal, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { useSearchList } from "@/lib/useSearchList";
import type { AdminLinkDTO, AdminLinkListDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AdminLinks() {
  const list = useSearchList<AdminLinkDTO>(async ({ q, cursor }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    const r = await api.get<AdminLinkListDTO>(`/admin/links?${params}`);
    return { items: r.links, nextCursor: r.nextCursor, total: r.total };
  });

  async function toggleActive(l: AdminLinkDTO) {
    try {
      await api.patch(`/admin/links/${l.id}`, { isActive: !l.isActive });
      list.patchItem((x) => x.id === l.id, (x) => ({ ...x, isActive: !x.isActive }));
      toast.success(l.isActive ? "Link paused" : "Link activated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function copyLink(l: AdminLinkDTO) {
    try {
      await navigator.clipboard.writeText(l.shortUrl);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  async function remove(l: AdminLinkDTO) {
    if (!window.confirm(`Delete /${l.slug}? This can't be undone.`)) return;
    try {
      await api.delete(`/admin/links/${l.id}`);
      list.removeItem((x) => x.id === l.id);
      toast.success("Link deleted");
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
            placeholder="Search slug, destination or title…"
            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {list.total !== undefined && (
          <span className="shrink-0 text-sm text-muted-foreground">
            {list.total.toLocaleString()} link{list.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Link</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No links found.
                </TableCell>
              </TableRow>
            ) : (
              list.items.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">/{l.slug}</span>
                      {!l.isActive && <Badge variant="muted">Paused</Badge>}
                    </div>
                    <div className="max-w-[22rem] truncate text-xs text-muted-foreground">
                      {l.title || l.destination}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-[12rem] truncate text-muted-foreground md:table-cell">
                    {l.ownerEmail}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatNumber(l.clickCount)}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground lg:table-cell">
                    {formatDate(l.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Link actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem asChild>
                          <a href={l.shortUrl} target="_blank" rel="noreferrer">
                            <ExternalLink /> Open
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => copyLink(l)}>
                          <Copy /> Copy link
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleActive(l)}>
                          {l.isActive ? "Pause link" : "Activate link"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => remove(l)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
