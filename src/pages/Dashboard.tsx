import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  BarChart3,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  QrCode,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";
import type { LinkDTO, LinkListDTO, ProjectDTO } from "@shared/types";
import { useProjects } from "@/lib/useProjects";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ProjectDialog } from "@/components/ProjectDialog";
import { BulkImportDialog } from "@/components/BulkImportDialog";
import { useConfirm } from "@/components/ConfirmProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { CopyButton } from "@/components/CopyButton";
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
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reqId = useRef(0);
  const loadingMoreRef = useRef(false);
  const navigate = useNavigate();

  const confirm = useConfirm();
  const { projects, selected, selectedId, setSelectedId, refresh: refreshProjects } =
    useProjects();
  const [projectDialog, setProjectDialog] = useState<{
    open: boolean;
    project: ProjectDTO | null;
  }>({ open: false, project: null });

  const fetchPage = useCallback(
    async (q: string, cur: string | null, pid: string | null, tag: string | null) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (cur) params.set("cursor", cur);
      if (pid) params.set("projectId", pid);
      if (tag) params.set("tag", tag);
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
    fetchPage(search, null, selectedId, activeTag)
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
  }, [search, selectedId, activeTag, nonce, fetchPage]);

  async function loadMore() {
    // Synchronous guard: a state-only check updates a render late, so a rapid
    // second call could append the same cursor page twice.
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const id = reqId.current;
    setLoadingMore(true);
    try {
      const data = await fetchPage(search, cursor, selectedId, activeTag);
      // A search/filter change reset the list while this was in flight — drop it.
      if (id !== reqId.current) return;
      setLinks((prev) => [...prev, ...data.links]);
      setCursor(data.nextCursor);
    } catch {
      if (id === reqId.current) toast.error("Couldn't load more");
    } finally {
      loadingMoreRef.current = false;
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
    const ok = await confirm({
      title: `Delete /${link.slug}?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProjectSwitcher
            projects={projects}
            selected={selected}
            onSelect={setSelectedId}
            onNew={() => setProjectDialog({ open: true, project: null })}
            onManage={() => selected && setProjectDialog({ open: true, project: selected })}
          />
          {selected && (
            <span className="hidden whitespace-nowrap text-sm text-muted-foreground sm:inline">
              {formatNumber(selected.linkCount)} {selected.linkCount === 1 ? "link" : "links"}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            aria-label="Import links"
            title="Import links"
          >
            <Upload /> <span className="hidden sm:inline">Import</span>
          </Button>
          <Button onClick={() => navigate("/dashboard/links/new")} aria-label="New link">
            <Plus /> <span className="hidden sm:inline">New link</span>
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your links…"
          aria-label="Search your links"
          className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {activeTag && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filtered by tag</span>
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
          >
            {activeTag} <X className="size-3" />
          </button>
        </div>
      )}

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
          <EmptyState onCreate={() => navigate("/dashboard/links/new")} />
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
                    href={link.shortUrl}
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
                  {link.destination}
                </div>
                {link.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {link.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setActiveTag(t)}
                        className={cn(
                          "rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground",
                          activeTag === t && "bg-primary/10 text-primary",
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="hidden flex-col items-end text-xs text-muted-foreground sm:flex">
                <span className="font-semibold text-foreground">
                  {formatNumber(link.clickCount)} clicks
                </span>
                <span>{timeAgo(link.createdAt)}</span>
              </div>

              <CopyButton value={link.shortUrl} />

              <Hint label="Edit">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit link"
                  onClick={() => navigate(`/dashboard/links/${link.id}/edit`)}
                >
                  <Pencil />
                </Button>
              </Hint>

              <Hint label={link.isActive ? "Deactivate" : "Activate"}>
                <Switch
                  checked={link.isActive}
                  onCheckedChange={() => toggleActive(link)}
                  aria-label={link.isActive ? "Deactivate link" : "Activate link"}
                />
              </Hint>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Link actions" title="More actions">
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
                    <a href={link.shortUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open link
                    </a>
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

      <BulkImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectId={selectedId}
        onImported={() => {
          setNonce((n) => n + 1);
          void refreshProjects();
        }}
      />

      <ProjectDialog
        open={projectDialog.open}
        onOpenChange={(o) => setProjectDialog((s) => ({ ...s, open: o }))}
        project={projectDialog.project}
        projects={projects}
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
