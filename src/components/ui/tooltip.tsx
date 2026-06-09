import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A tiny, dependency-free tooltip. Shows on hover (desktop), on focus-within
 * (keyboard) and on tap-focus (mobile) — so an icon-only control is explained
 * everywhere. Pure CSS, no portal: the label is absolutely positioned and
 * pointer-transparent so it never blocks the control.
 */
export function Hint({
  label,
  children,
  side = "top",
  className,
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  return (
    <span className={cn("group/hint relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 scale-95 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-md transition duration-150 group-hover/hint:scale-100 group-hover/hint:opacity-100 group-focus-within/hint:scale-100 group-focus-within/hint:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {label}
      </span>
    </span>
  );
}
