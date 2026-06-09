import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { formatDate, timeAgo } from "@/lib/format";
import type { ApiKeyCreatedDTO, ApiKeyDTO, ApiKeyListDTO } from "@shared/types";
import { useConfirm } from "@/components/ConfirmProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function HowStep({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        {n}
      </span>
      <p className="mt-2.5 text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

function CopyIcon({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Hint label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
    </Hint>
  );
}

/** A curl example shown like the Domains page's DNS records: bordered mono rows.
 *  No overflow-hidden on the container — it would clip the copy tooltip. */
function CodeRow({ label, code }: { label: string; code: string }) {
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <CopyIcon value={code} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">{code}</pre>
    </div>
  );
}

export function ApiKeys() {
  const { config } = useConfig();
  const confirm = useConfirm();
  const [keys, setKeys] = useState<ApiKeyDTO[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  // The freshly minted secret — surfaced inline above the list, shown once.
  const [reveal, setReveal] = useState<{ key: string; name: string } | null>(null);

  useEffect(() => {
    api
      .get<ApiKeyListDTO>("/keys")
      .then((r) => setKeys(r.keys))
      .catch(() => toast.error("Couldn't load your API keys"));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const r = await api.post<ApiKeyCreatedDTO>("/keys", { name: name.trim() });
      setKeys((k) => [r.apiKey, ...(k ?? [])]);
      setReveal({ key: r.key, name: r.apiKey.name });
      setName("");
      setCreateOpen(false);
      toast.success("API key created");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't create the key");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(k: ApiKeyDTO) {
    const ok = await confirm({
      title: `Revoke "${k.name}"?`,
      description: "Anything using this key stops working immediately.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/keys/${k.id}`);
      setKeys((list) => (list ?? []).filter((x) => x.id !== k.id));
      toast.success("Key revoked");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't revoke it");
    }
  }

  // Docs always show the canonical public origin, never a dev host.
  const origin = config.appOrigin || window.location.origin;
  const keyPlaceholder = "sk_YOUR_KEY";
  const mcpName = config.appName.toLowerCase().replace(/\s+/g, "-") || "shortlink";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="display text-3xl">API keys</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Create and manage short links from your own code — same features as the
            dashboard, authenticated with a bearer key.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!config.apiEnabled}>
          <Plus /> New key
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <HowStep n={1} title="Create a key" desc="Name it after the app or script that will use it." />
        <HowStep n={2} title="Send it as a Bearer token" desc={`Call ${origin}/api/v1 with an Authorization header.`} />
        <HowStep n={3} title="Revoke any time" desc="Deleting a key cuts off whatever used it, instantly." />
      </div>

      {!config.apiEnabled && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          The public API is currently turned off by an administrator — keys can’t be
          created or used until it’s re-enabled.
        </p>
      )}

      {/* One-time key reveal — stays until dismissed. */}
      {reveal && (
        <Card className="border-primary/40">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">
                “{reveal.name}” is ready — copy the key now
              </p>
              <Badge variant="secondary">shown once</Badge>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{reveal.key}</code>
              <CopyIcon value={reveal.key} label="Copy key" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Store it somewhere safe — it can’t be shown again.
              </p>
              <Button variant="outline" size="sm" onClick={() => setReveal(null)}>
                Done
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {keys === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center">
          <KeyRound className="mx-auto size-7 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium">No API keys yet</p>
          <p className="text-sm text-muted-foreground">
            Create one to start building with the API.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <KeyRound className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{k.name}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {k.prefix}••••••••
                </div>
              </div>
              <div className="hidden flex-col items-end text-xs text-muted-foreground sm:flex">
                <span>{k.lastUsedAt ? `Used ${timeAgo(k.lastUsedAt)}` : "Never used"}</span>
                <span>Created {formatDate(k.createdAt)}</span>
              </div>
              <Hint label="Revoke">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => revoke(k)}
                  aria-label="Revoke key"
                >
                  <Trash2 />
                </Button>
              </Hint>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quick start</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Endpoints live under{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {origin}/api/v1
            </code>{" "}
            and accept JSON. Also available: <code className="font-mono text-xs">PATCH /links/:id</code>,{" "}
            <code className="font-mono text-xs">DELETE /links/:id</code>,{" "}
            <code className="font-mono text-xs">GET /domains</code>,{" "}
            <code className="font-mono text-xs">GET /projects</code>.
          </p>
          <CodeRow
            label="Create a link"
            code={`curl -X POST ${origin}/api/v1/links \\
  -H "Authorization: Bearer ${keyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{"destination": "https://example.com", "slug": "my-link"}'`}
          />
          <CodeRow
            label="List your links"
            code={`curl ${origin}/api/v1/links \\
  -H "Authorization: Bearer ${keyPlaceholder}"`}
          />
          <CodeRow
            label="Analytics for a link"
            code={`curl "${origin}/api/v1/links/LINK_ID/stats?range=7d" \\
  -H "Authorization: Bearer ${keyPlaceholder}"`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Connect an AI agent (MCP)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A built-in MCP server lets agents create, edit and analyse links with the
            same key — point them at{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{origin}/mcp</code>.
          </p>
          {!config.mcpEnabled && (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              The MCP server is currently turned off by an administrator.
            </p>
          )}
          <CodeRow
            label="Claude Code"
            code={`claude mcp add --transport http ${mcpName} ${origin}/mcp \\
  --header "Authorization: Bearer ${keyPlaceholder}"`}
          />
          <CodeRow
            label="Claude Desktop / Cursor (mcp-remote)"
            code={`{
  "mcpServers": {
    "${mcpName}": {
      "command": "npx",
      "args": ["mcp-remote", "${origin}/mcp",
               "--header", "Authorization: Bearer ${keyPlaceholder}"]
    }
  }
}`}
          />
          <p className="text-xs text-muted-foreground">
            Tools: create_link, list_links, get_link, update_link, delete_link,
            get_link_stats, get_link_activity, list_domains, list_projects, bulk_import,
            get_qr.
          </p>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              Name it after what will use it — you can revoke it any time.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Zapier integration"
                maxLength={40}
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={creating || !name.trim()}>
              {creating && <Loader2 className="animate-spin" />}
              Create key
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
