import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visually indeterminate (e.g. "some selected") — still toggles on click. */
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** A styled checkbox (no native OS appearance) used across the app. */
export function Checkbox({
  checked,
  onCheckedChange,
  indeterminate,
  disabled,
  className,
  "aria-label": ariaLabel,
}: CheckboxProps) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:border-primary/60",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {indeterminate ? (
        <Minus className="size-3.5" strokeWidth={3.5} />
      ) : checked ? (
        <Check className="size-3.5" strokeWidth={3.5} />
      ) : null}
    </button>
  );
}
