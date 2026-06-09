import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  BarChart3,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  QrCode,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn, shortUrlFor } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";
import type { LinkDTO, LinkListDTO, ProjectDTO } from "@shared/types";
import { useProjects } from "@/lib/useProjects";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ProjectDialog } from "@/components/ProjectDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/CopyButton";
import { LinkFormDialog } from "@/components/LinkFormDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Dashboard() {
  const [links, setLinks] = useState<LinkDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LinkDTO | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const reqId = useRef(0);

  const { projects, selected, selectedId, setSelectedId, refresh: refreshProjects } =
    useProjects();
  const [projectDialog, setProjectDialog] = useState<{
    open: boolean;
    project: ProjectDTO | null;
  }>({ open: false, project: null });

  const fetchPage = useCallback(
    async (q: string, cur: string | null, pid: string | null) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (cur) params.set("cursor", cur);
      if (pid) params.set("projectId", pid);
      return api.get<LinkListDTO>(`/links?${params}`);
    },
    [],
  );

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Reload from scratch whenever the (debounced) search changes.
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    fetchPage(search, null, selectedId)
      .then((data) => {
        if (id !== reqId.current) return;
        setLinks(data.links);
        setCursor(data.nextCursor);
      })
      .catch(() => {
        if (id === reqId.current) toast.error("Couldn't load your links");
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [search, selectedId, fetchPage]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(search, cursor, selectedId);
      setLinks((prev) => [...prev, ...data.links]);
      setCursor(data.nextCursor);
    } catch {
      toast.error("Couldn't load more");
    } finally {
      setLoadingMore(false);
    }
  }

  function upsert(link: LinkDTO) {
    setLinks((prev) => {
      const exists = prev.some((l) => l.id === link.id);
      return exists
        ? prev.map((l) => (l.id === link.id ? link : l))
        : [link, ...prev];
    });
  }

  async function toggleActive(link: LinkDTO) {
    try {
      const { link: updated } = await api.patch<{ link: LinkDTO }>(
        `/links/${link.id}`,
        { isActive: !link.isActive },
      );
      upsert(updated);
      toast.success(updated.isActive ? "Link activated" : "Link deactivated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function remove(link: LinkDTO) {
    if (!window.confirm(`Delete /${link.slug}? This can't be undone.`)) return;
    try {
      await api.delete(`/links/${link.id}`);
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      void refreshProjects();
      toast.success("Link deleted");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <ProjectSwitcher
          projects={projects}
          selected={selected}
          onSelect={setSelectedId}
          onNew={() => setProjectDialog({ open: true, project: null })}
          onManage={() => selected && setProjectDialog({ open: true, project: selected })}
        />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus /> New link
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your links…"
          className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] w-full" />
          ))}
        </div>
      ) : links.length === 0 ? (
        search ? (
          <p className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
            No links match “{search}”.
          </p>
        ) : (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        )
      ) : (
        <ul className="space-y-3">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-3 rounded-lg border bg-card p-3"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Link2 className="size-4" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <a
                    href={shortUrlFor(link.slug)}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "truncate font-medium text-primary hover:underline",
                      !link.isActive && "text-muted-foreground line-through",
                    )}
                  >
                    /{link.slug}
                  </a>
                  {!link.isActive && <Badge variant="muted">Inactive</Badge>}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {link.title ? `${link.title} · ` : ""}
                  {link.destination}
                </div>
              </div>

              <div className="hidden flex-col items-end text-xs text-muted-foreground sm:flex">
                <span className="font-semibold text-foreground">
                  {formatNumber(link.clickCount)} clicks
                </span>
                <span>{timeAgo(link.createdAt)}</span>
              </div>

              <CopyButton value={shortUrlFor(link.slug)} />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Link actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem asChild>
                    <RouterLink to={`/links/${link.id}`}>
                      <BarChart3 /> Analytics
                    </RouterLink>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <RouterLink to={`/links/${link.id}/qr`}>
                      <QrCode /> QR code
                    </RouterLink>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={shortUrlFor(link.slug)} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open link
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditing(link)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleActive(link)}>
                    <Power /> {link.isActive ? "Deactivate" : "Activate"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => remove(link)}
                  >
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <LinkFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={selectedId ?? undefined}
        onSaved={(l) => {
          upsert(l);
          void refreshProjects();
        }}
      />
      <LinkFormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        link={editing}
        onSaved={upsert}
      />

      <ProjectDialog
        open={projectDialog.open}
        onOpenChange={(o) => setProjectDialog((s) => ({ ...s, open: o }))}
        project={projectDialog.project}
        onSaved={(p) => {
          void refreshProjects();
          if (!projectDialog.project) setSelectedId(p.id);
        }}
        onDeleted={() => void refreshProjects()}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Link2 className="size-6" />
      </div>
      <h3 className="mt-4 font-semibold">No links yet</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        Create your first short link and start tracking clicks.
      </p>
      <Button className="mt-6" onClick={onCreate}>
        <Plus /> New link
      </Button>
    </div>
  );
}
