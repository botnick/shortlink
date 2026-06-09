import { useState, type FormEvent } from "react";
import { KeyRound, Link2, MoreHorizontal, Plus, Search, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useSearchList } from "@/lib/useSearchList";
import type { AdminUserDTO, AdminUserListDTO, Role } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function AdminTeam({ onViewLinks }: { onViewLinks?: (u: AdminUserDTO) => void }) {
  const { user: me } = useAuth();
  const list = useSearchList<AdminUserDTO>(async ({ q, cursor }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    const r = await api.get<AdminUserListDTO>(`/admin/users?${params}`);
    return { items: r.users, nextCursor: r.nextCursor, total: r.total };
  });

  const [addOpen, setAddOpen] = useState(false);
  const [resetUser, setResetUser] = useState<AdminUserDTO | null>(null);

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
        <Button onClick={() => setAddOpen(true)}><Plus /> Add member</Button>
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
                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No members found.</TableCell></TableRow>
            ) : (
              list.items.map((u) => {
                const isSelf = u.id === me?.id;
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
                    <TableCell className="hidden text-right text-muted-foreground sm:table-cell">{formatDate(u.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="User actions"><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {onViewLinks && u.linkCount > 0 && (
                            <DropdownMenuItem onClick={() => onViewLinks(u)}><Link2 /> View links</DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => setResetUser(u)}><KeyRound /> Reset password</DropdownMenuItem>
                          {!u.isPrimary && !isSelf && (
                            <>
                              {u.role === "user" ? (
                                <DropdownMenuItem onClick={() => setRole(u, "admin")}><ShieldCheck /> Make admin</DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => setRole(u, "user")}><ShieldOff /> Remove admin</DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => removeUser(u)}><Trash2 /> Delete user</DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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

      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} onAdded={(u) => list.addItem(u)} />
      <ResetPasswordDialog user={resetUser} onOpenChange={(o) => !o && setResetUser(null)} />
    </div>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: (u: AdminUserDTO) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { user } = await api.post<{ user: AdminUserDTO }>("/admin/users", { email, password, role });
      toast.success(`${user.email} added`);
      setEmail(""); setPassword(""); setRole("user");
      onOpenChange(false);
      onAdded(user);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't add member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add member</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="m-email">Email</Label>
            <Input id="m-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-pass">Password</Label>
            <Input id="m-pass" type="text" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(["user", "admin"] as Role[]).map((r) => (
                <button key={r} type="button" onClick={() => setRole(r)}
                  className={role === r ? "flex-1 rounded-md bg-card px-3 py-1.5 text-sm font-medium shadow-sm" : "flex-1 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground"}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={saving}>{saving ? "Adding…" : "Add member"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: AdminUserDTO | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await api.post(`/admin/users/${user.id}/password`, { password });
      toast.success(`Password reset — ${user.email} was signed out`);
      setPassword("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reset password</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Set a new password for <span className="font-medium">{user?.email}</span>. They’ll be
            signed out of all sessions.
          </p>
          <div className="space-y-2">
            <Label htmlFor="r-pass">New password</Label>
            <Input id="r-pass" type="text" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>{saving ? "Saving…" : "Reset password"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
