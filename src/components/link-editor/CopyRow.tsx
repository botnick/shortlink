import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** A bordered row showing a value with a copy-to-clipboard button. */
export function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm" title={value}>
        {value}
      </span>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
