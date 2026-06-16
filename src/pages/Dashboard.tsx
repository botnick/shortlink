import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  BarChart3,
  ExternalLink,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
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
import { isHttpUrl } from "@/lib/linkForm";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ProjectDialog } from "@/components/ProjectDialog";
import { BulkImportDialog } from "@/components/BulkImportDialog";
import { useConfirm } from "@/components/ConfirmProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  const [quickUrl, setQuickUrl] = useState("");
  const [quickSubmitting, setQuickSubmitting] = useState(false);
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

  // Quick create: paste a long link, hit Shorten, and the server picks the
  // back-half. A bare domain gets https:// added, like the full editor does.
  const quickDestination = quickUrl.trim()
    ? isHttpUrl(quickUrl.trim())
      ? quickUrl.trim()
      : `https://${quickUrl.trim()}`
    : "";
  const quickValid = isHttpUrl(quickDestination);

  async function quickCreate(e: FormEvent) {
    e.preventDefault();
    if (!quickValid || quickSubmitting) return;
    setQuickSubmitting(true);
    try {
      const { link } = await api.post<{ link: LinkDTO }>("/links", {
        destination: quickDestination,
        projectId: selectedId ?? undefined,
      });
      upsert(link);
      setQuickUrl("");
      void refreshProjects();
      toast.success("Short link created");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't create link");
    } finally {
      setQuickSubmitting(false);
    }
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

      {/* Quick create — paste a link and shorten it instantly (the server picks
          the back-half). The full editor ("New link") stays for tracking/options. */}
      <div className="space-y-1.5">
        <form
          onSubmit={quickCreate}
          className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4"
        >
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="url"
              inputMode="url"
              value={quickUrl}
              onChange={(e) => setQuickUrl(e.target.value)}
              placeholder="Paste a long link to shorten…"
              aria-label="Paste a link to shorten"
              className="h-11 w-full rounded-lg border bg-background pl-9 pr-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button
            type="submit"
            disabled={!quickValid || quickSubmitting}
            className="min-h-11 shrink-0"
          >
            {quickSubmitting ? <Loader2 className="animate-spin" /> : <Plus />}
            Shorten
          </Button>
        </form>
        {quickUrl.trim() && !quickValid && (
          <p className="px-1 text-xs text-amber-600">
            Enter a valid link, e.g. example.com — we’ll add https:// for you.
          </p>
        )}
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
              className="flex items-center gap-3 rounded-lg border bg-card p-4"
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

              {/* Copy is the primary action — labelled and prominent so it's the
                  obvious, large tap target (≥44px). */}
              <CopyButton
                value={link.shortUrl}
                label="Copy"
                variant="secondary"
                className="min-h-11"
              />

              <Hint label="Edit">
                <Button
                  variant="ghost"
                  aria-label="Edit link"
                  className="min-h-11"
                  onClick={() => navigate(`/dashboard/links/${link.id}/edit`)}
                >
                  <Pencil /> <span className="hidden sm:inline">Edit</span>
                </Button>
              </Hint>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label="Link actions"
                    title="More actions"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {/* Activate/Deactivate lives in the menu (not an inline switch)
                      so it can't be toggled by an accidental tap. */}
                  <DropdownMenuItem
                    onClick={() => toggleActive(link)}
                    className={link.isActive ? "text-amber-600 focus:text-amber-600" : undefined}
                  >
                    {link.isActive ? <PowerOff /> : <Power />}
                    {link.isActive ? "Deactivate link" : "Activate link"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
