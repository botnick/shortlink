import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { compressUpload } from "@/lib/ogTemplates";
import { useConfig } from "@/lib/config";
import type { ProjectDTO } from "@shared/types";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/ColorPicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode. */
  project?: ProjectDTO | null;
  /** All of the user's projects (for choosing a move target on delete). */
  projects: ProjectDTO[];
  onSaved: (project: ProjectDTO) => void;
  onDeleted?: (id: string) => void;
}

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  projects,
  onSaved,
  onDeleted,
}: Props) {
  const isEdit = Boolean(project);
  const { config } = useConfig();
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [logo, setLogo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Delete sub-view (no native confirm): choose to move links or delete them.
  const others = projects.filter((p) => p.id !== project?.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"move" | "delete">("move");
  const [moveTo, setMoveTo] = useState("");

  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setColor(project?.color ?? "");
      setLogo(project?.logo ?? "");
      setConfirmDelete(false);
      setDeleteMode("move");
      setMoveTo(projects.find((p) => p.id !== project?.id)?.id ?? "");
    }
  }, [open, project, projects]);

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error("Image is too large (max ~5MB)");
      return;
    }
    try {
      setLogo(await compressUpload(file, 512, 0.9));
    } catch {
      toast.error("Couldn't read that image");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const body = { name: name.trim(), color: color || "", logo: logo || null };
      const { project: saved } = isEdit
        ? await api.patch<{ project: ProjectDTO }>(`/projects/${project!.id}`, body)
        : await api.post<{ project: ProjectDTO }>("/projects", body);
      onSaved(saved);
      toast.success(isEdit ? "Project updated" : "Project created");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function doDelete() {
    if (!project) return;
    setSubmitting(true);
    try {
      const qs =
        deleteMode === "move"
          ? `?action=move&to=${encodeURIComponent(moveTo)}`
          : "?action=delete";
      await api.delete(`/projects/${project.id}${qs}`);
      onDeleted?.(project.id);
      toast.success("Project deleted");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {confirmDelete && project ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete “{project.name}”?</DialogTitle>
              <DialogDescription>
                {project.linkCount > 0
                  ? `This project has ${project.linkCount} ${project.linkCount === 1 ? "link" : "links"}. Choose what happens to them.`
                  : "This project has no links."}
              </DialogDescription>
            </DialogHeader>

            {project.linkCount > 0 && (
              <div className="space-y-3">
                <label className="flex items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary">
                  <input
                    type="radio"
                    name="del"
                    checked={deleteMode === "move"}
                    onChange={() => setDeleteMode("move")}
                    className="mt-1 accent-primary"
                  />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block text-sm font-medium">Move the links to another project</span>
                    <select
                      value={moveTo}
                      onChange={(e) => setMoveTo(e.target.value)}
                      onClick={() => setDeleteMode("move")}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {others.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 has-[:checked]:border-destructive">
                  <input
                    type="radio"
                    name="del"
                    checked={deleteMode === "delete"}
                    onChange={() => setDeleteMode("delete")}
                    className="mt-1 accent-destructive"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-destructive">
                      Delete the links too
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Permanently removes the {project.linkCount} links and their analytics.
                    </span>
                  </span>
                </label>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDelete(false)}
                disabled={submitting}
              >
                <ArrowLeft /> Back
              </Button>
              <Button type="button" variant="destructive" onClick={doDelete} disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                Delete project
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{isEdit ? "Edit project" : "New project"}</DialogTitle>
              <DialogDescription>
                {isEdit
                  ? "Rename or rebrand this project."
                  : "Group links under a project with its own brand presets."}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pname">Name</Label>
                <Input
                  id="pname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Marketing"
                  autoFocus
                  maxLength={60}
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Brand color{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <div className="flex items-center gap-2">
                  <ColorPicker value={color || config.brandColor} onChange={setColor} />
                  {color && (
                    <button
                      type="button"
                      onClick={() => setColor("")}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Inherit
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>
                  Logo <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <div className="flex items-center gap-3">
                  {logo ? (
                    <img src={logo} alt="" className="size-11 rounded-lg border object-cover" />
                  ) : (
                    <div className="flex size-11 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                      —
                    </div>
                  )}
                  <label className="cursor-pointer rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
                    {logo ? "Replace" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => void pickLogo(e.target.files?.[0])}
                    />
                  </label>
                  {logo && (
                    <button
                      type="button"
                      onClick={() => setLogo("")}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <DialogFooter className="sm:justify-between">
                {isEdit && others.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                    disabled={submitting}
                  >
                    <Trash2 /> Delete
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <DialogClose asChild>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="animate-spin" />}
                    {isEdit ? "Save" : "Create"}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
