import { useState } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  MoreHorizontal,
  Search,
  Trash2,
  X,
} from "lucide-react";
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

export function AdminLinks({
  userId,
  userLabel,
  onClearFilter,
}: {
  userId?: string;
  userLabel?: string;
  onClearFilter?: () => void;
}) {
  const list = useSearchList<AdminLinkDTO>(async ({ q, cursor }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    if (userId) params.set("userId", userId);
    const r = await api.get<AdminLinkListDTO>(`/admin/links?${params}`);
    return { items: r.links, nextCursor: r.nextCursor, total: r.total };
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulking, setBulking] = useState(false);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) =>
      s.size === list.items.length ? new Set() : new Set(list.items.map((l) => l.id)),
    );
  }

  async function bulk(action: "pause" | "activate" | "delete") {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(`Delete ${ids.length} link(s)? This can't be undone.`)) return;
    setBulking(true);
    try {
      await api.post("/admin/links/bulk", { ids, action });
      if (action === "delete") {
        ids.forEach((id) => list.removeItem((x) => x.id === id));
      } else {
        const isActive = action === "activate";
        ids.forEach((id) => list.patchItem((x) => x.id === id, (x) => ({ ...x, isActive })));
      }
      setSelected(new Set());
      toast.success(`${ids.length} link(s) updated`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bulk action failed");
    } finally {
      setBulking(false);
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

  const allChecked = list.items.length > 0 && selected.size === list.items.length;

  return (
    <div className="space-y-4">
      {userId && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span>
            Showing links for <span className="font-medium">{userLabel}</span>
          </span>
          <button onClick={onClearFilter} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" /> Clear
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={list.query}
            onChange={(e) => list.setQuery(e.target.value)}
            placeholder="Search slug, URL, title or owner…"
            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button asChild variant="outline">
          <a href="/api/admin/export/links.csv">
            <Download /> Export CSV
          </a>
        </Button>
        {list.total !== undefined && (
          <span className="text-sm text-muted-foreground">
            {list.total.toLocaleString()} link{list.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
          <span className="px-2 text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" disabled={bulking} onClick={() => bulk("activate")}>Activate</Button>
          <Button size="sm" variant="outline" disabled={bulking} onClick={() => bulk("pause")}>Pause</Button>
          <Button size="sm" variant="outline" disabled={bulking} onClick={() => bulk("delete")} className="text-destructive">Delete</Button>
          <button onClick={() => setSelected(new Set())} className="ml-auto px-2 text-sm text-muted-foreground hover:text-foreground">Clear</button>
        </div>
      )}

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" className="size-4 accent-primary" />
              </TableHead>
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
                  <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No links found.</TableCell>
              </TableRow>
            ) : (
              list.items.map((l) => (
                <TableRow key={l.id} data-state={selected.has(l.id) ? "selected" : undefined}>
                  <TableCell>
                    <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.slug}`} className="size-4 accent-primary" />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">/{l.slug}</span>
                      {!l.isActive && <Badge variant="muted">Paused</Badge>}
                    </div>
                    <div className="max-w-[22rem] truncate text-xs text-muted-foreground">{l.title || l.destination}</div>
                  </TableCell>
                  <TableCell className="hidden max-w-[12rem] truncate text-muted-foreground md:table-cell">{l.ownerEmail}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatNumber(l.clickCount)}</TableCell>
                  <TableCell className="hidden text-right text-muted-foreground lg:table-cell">{formatDate(l.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Link actions"><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem asChild>
                          <a href={l.shortUrl} target="_blank" rel="noreferrer"><ExternalLink /> Open</a>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => copyLink(l)}><Copy /> Copy link</DropdownMenuItem>
                        <DropdownMenuItem onClick={async () => {
                          try {
                            await api.patch(`/admin/links/${l.id}`, { isActive: !l.isActive });
                            list.patchItem((x) => x.id === l.id, (x) => ({ ...x, isActive: !x.isActive }));
                            toast.success(l.isActive ? "Link paused" : "Link activated");
                          } catch (err) { toast.error(err instanceof ApiError ? err.message : "Update failed"); }
                        }}>
                          {l.isActive ? "Pause link" : "Activate link"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => remove(l)}><Trash2 /> Delete</DropdownMenuItem>
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
