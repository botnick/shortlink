import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { LinkDTO } from "@shared/types";
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
import { Switch } from "@/components/ui/switch";
import { useShortHost } from "@/lib/config";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link?: LinkDTO | null;
  onSaved: (link: LinkDTO) => void;
}

export function LinkFormDialog({ open, onOpenChange, link, onSaved }: Props) {
  const isEdit = Boolean(link);
  const shortHost = useShortHost();
  const [destination, setDestination] = useState("");
  const [alias, setAlias] = useState("");
  const [title, setTitle] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setDestination(link?.destination ?? "");
      setAlias("");
      setTitle(link?.title ?? "");
      setIsActive(link?.isActive ?? true);
    }
  }, [open, link]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isEdit && link) {
        const { link: updated } = await api.patch<{ link: LinkDTO }>(
          `/links/${link.id}`,
          { destination, title: title.trim() || null, isActive },
        );
        toast.success("Link updated");
        onSaved(updated);
      } else {
        const { link: created } = await api.post<{ link: LinkDTO }>("/links", {
          destination,
          slug: alias.trim() || undefined,
          title: title.trim() || undefined,
        });
        toast.success("Short link created");
        onSaved(created);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit link" : "Create short link"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update where this short link points."
              : "Shorten a long URL. Optionally pick a custom alias."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="destination">Destination URL</Label>
            <Input
              id="destination"
              type="url"
              required
              autoFocus
              placeholder="https://example.com/a/very/long/link"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </div>

          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="alias">
                Custom alias{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <div className="flex items-center overflow-hidden rounded-md border border-input bg-transparent text-sm focus-within:ring-2 focus-within:ring-ring">
                <span className="whitespace-nowrap pl-3 text-muted-foreground">
                  {shortHost}/
                </span>
                <input
                  id="alias"
                  className="h-9 w-full bg-transparent px-1 text-base outline-none md:text-sm"
                  placeholder="my-link"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">
              Title{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="title"
              placeholder="Spring campaign"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {isEdit && (
            <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">Active</span>
                <span className="block text-xs text-muted-foreground">
                  Inactive links stop redirecting.
                </span>
              </span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />}
              {isEdit ? "Save changes" : "Create link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
