import { cn } from "@/lib/utils";
import { useConfig } from "@/lib/config";

/** Dynamic brand mark — a rounded square in the brand color with the app's initial. */
export function BrandMark({ className }: { className?: string }) {
  const { config } = useConfig();
  const initial = config.appName.trim().charAt(0).toUpperCase() || "•";
  return (
    <span
      className={cn(
        "inline-flex aspect-square select-none items-center justify-center rounded-md bg-primary font-bold leading-none text-primary-foreground",
        className,
      )}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

export function Logo({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  const { config } = useConfig();
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {config.logoUrl ? (
        <img
          src={config.logoUrl}
          alt=""
          className="size-6 rounded object-contain"
        />
      ) : (
        <BrandMark className="size-6 text-sm" />
      )}
      {showText && (
        <span className="text-lg font-bold tracking-tight">{config.appName}</span>
      )}
    </span>
  );
}
