import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/** The one standard "back" link used across pages (arrow + label, muted). */
export function BackLink({ to, label = "Back" }: { to: string; label?: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> {label}
    </Link>
  );
}
