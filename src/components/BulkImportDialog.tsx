import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useShortHost } from "@/lib/config";
import type { BulkImportResultDTO, DomainDTO, DomainListDTO } from "@shared/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Row {
  destination: string;
  slug?: string;
  tags?: string[];
}

/** Parse pasted/CSV text: one link per line — `destination[,slug[,tags]]` where
 *  tags are space/|/;-separated. A bare domain gets https:// added. */
function parseRows(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [dest = "", slug = "", tagStr = ""] = line.split(",").map((s) => s.trim());
      let destination = dest;
      if (destination && !/^[a-z][a-z0-9+.-]*:\/\//i.test(destination)) {
        destination = `https://${destination}`;
      }
      const tags = tagStr
        ? tagStr.split(/[ |;]+/).map((t) => t.trim()).filter(Boolean)
        : undefined;
      return { destination, slug: slug || undefined, tags };
    })
    .filter((r) => r.destination);
}

export function BulkImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkImportResultDTO | null>(null);
  // Host the whole batch lands on (null = the default short host).
  const [domainId, setDomainId] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainDTO[]>([]);
  const shortHost = useShortHost();

  const rows = useMemo(() => parseRows(text), [text]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    api
      .get<DomainListDTO>("/domains")
      .then((r) => {
        if (active)
          setDomains(
            r.domains.filter((d) => d.status === "verified" || d.status === "active"),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  function reset() {
    setText("");
    setResult(null);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText((prev) => (prev ? `${prev}\n` : "") + String(reader.result));
    reader.readAsText(file);
    e.target.value = "";
  }

  async function run() {
    if (rows.length === 0) return;
    if (rows.length > 500) {
      toast.error("Up to 500 links per import");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<BulkImportResultDTO>("/links/import", {
        rows: rows.map((r) => ({ ...r, domainId: domainId ?? undefined })),
      });
      setResult(res);
      if (res.created.length) onImported();
      toast.success(`Imported ${res.created.length} link${res.created.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import links</DialogTitle>
          <DialogDescription>
            One link per line: <code>destination,slug,tags</code> — slug and tags optional
            (tags separated by spaces). A bare domain gets https:// added.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <span className="font-medium text-emerald-600">{result.created.length} created</span>
              {result.errors.length > 0 && (
                <span className="text-destructive">
                  {" "}
                  · {result.errors.length} skipped
                </span>
              )}
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-auto rounded-lg border p-2 text-xs">
                {result.errors.map((e) => (
                  <div key={e.index} className="flex gap-2">
                    <span className="shrink-0 text-muted-foreground">#{e.index + 1}</span>
                    <span className="min-w-0 flex-1 truncate" title={e.destination}>
                      {e.destination}
                    </span>
                    <span className="shrink-0 text-destructive">{e.reason}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset}>
                Import more
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {domains.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Create on</span>
                <select
                  value={domainId ?? ""}
                  onChange={(e) => setDomainId(e.target.value || null)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Domain for imported links"
                >
                  <option value="">{shortHost} (default)</option>
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.hostname}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"example.com/page,promo,marketing q1\nhttps://blog.site/post"}
              className="w-full rounded-lg border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <Upload className="size-4" />
                Upload .csv
                <input type="file" accept=".csv,.txt" className="sr-only" onChange={onFile} />
              </label>
              <span className="text-xs text-muted-foreground">
                {rows.length} link{rows.length === 1 ? "" : "s"} ready
              </span>
            </div>
            <div className="flex justify-end">
              <Button onClick={run} disabled={busy || rows.length === 0}>
                {busy && <Loader2 className="animate-spin" />}
                Import {rows.length > 0 ? rows.length : ""}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
