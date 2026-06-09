import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Trash2 } from "lucide-react";
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
  onSaved: (project: ProjectDTO) => void;
  onDeleted?: (id: string) => void;
}

export function ProjectDialog({ open, onOpenChange, project, onSaved, onDeleted }: Props) {
  const isEdit = Boolean(project);
  const { config } = useConfig();
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [logo, setLogo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setColor(project?.color ?? "");
      setLogo(project?.logo ?? "");
    }
  }, [open, project]);

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

  async function del() {
    if (!project) return;
    if (!window.confirm(`Delete “${project.name}”? Its links move to your default project.`)) {
      return;
    }
    setSubmitting(true);
    try {
      await api.delete(`/projects/${project.id}`);
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
            {isEdit && !project!.isDefault ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={del}
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
      </DialogContent>
    </Dialog>
  );
}
