import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { LinkAliasDTO } from "@shared/types";

/** One retired back-half in the edit history: its URL, age, and a copy button.
 *  Old back-halves are permanent (they keep redirecting) — no remove. */
export function AliasRow({ alias }: { alias: LinkAliasDTO }) {
  const [copied, setCopied] = useState(false);
  const display = alias.shortUrl.replace(/^https?:\/\//, "");
  return (
    <li className="flex items-center gap-2 px-2.5 py-1.5">
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        title={alias.shortUrl}
      >
        {display}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground/70">
        {timeAgo(alias.createdAt)}
      </span>
      <button
        type="button"
        aria-label="Copy old short link"
        onClick={() => {
          void navigator.clipboard.writeText(alias.shortUrl);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </li>
  );
}
