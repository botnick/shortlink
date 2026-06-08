import { MoreHorizontal, Search, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useSearchList } from "@/lib/useSearchList";
import type { AdminUserDTO, AdminUserListDTO, Role } from "@shared/types";
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

export function AdminTeam() {
  const { user: me } = useAuth();
  const list = useSearchList<AdminUserDTO>(async ({ q, cursor }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    const r = await api.get<AdminUserListDTO>(`/admin/users?${params}`);
    return { items: r.users, nextCursor: r.nextCursor, total: r.total };
  });

  async function setRole(u: AdminUserDTO, role: Role) {
    try {
      await api.patch(`/admin/users/${u.id}`, { role });
      list.patchItem((x) => x.id === u.id, (x) => ({ ...x, role }));
      toast.success(role === "admin" ? `${u.email} is now an admin` : `${u.email} is no longer an admin`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function removeUser(u: AdminUserDTO) {
    if (!window.confirm(`Delete ${u.email}? This removes their account and links.`)) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      list.removeItem((x) => x.id === u.id);
      toast.success("User deleted");
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
            placeholder="Search by email…"
            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {list.total !== undefined && (
          <span className="shrink-0 text-sm text-muted-foreground">
            {list.total.toLocaleString()} member{list.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Links</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Joined</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No members found.
                </TableCell>
              </TableRow>
            ) : (
              list.items.map((u) => {
                const isSelf = u.id === me?.id;
                const actionable = !u.isPrimary && !isSelf;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="max-w-[14rem] truncate font-medium">{u.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={u.role === "admin" ? "default" : "muted"}>{u.role}</Badge>
                        {u.isPrimary && <Badge variant="secondary">Primary</Badge>}
                        {isSelf && <span className="text-xs text-muted-foreground">you</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.linkCount}</TableCell>
                    <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                      {formatDate(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {actionable ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="User actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {u.role === "user" ? (
                              <DropdownMenuItem onClick={() => setRole(u, "admin")}>
                                <ShieldCheck /> Make admin
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => setRole(u, "user")}>
                                <ShieldOff /> Remove admin
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => removeUser(u)}>
                              <Trash2 /> Delete user
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
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
