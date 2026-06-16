import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

type CopyButtonProps = Omit<ButtonProps, "value"> & {
  value: string;
  label?: string;
};

export function CopyButton({
  value,
  label,
  variant = "ghost",
  size = "icon",
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  const btn = (
    <Button
      type="button"
      variant={variant}
      size={label ? "default" : size}
      onClick={copy}
      aria-label={label ? undefined : "Copy"}
      {...props}
    >
      {copied ? <Check className="text-emerald-500" /> : <Copy />}
      {label ? (copied ? "Copied" : label) : null}
    </Button>
  );
  // Icon-only copy buttons get a tooltip so they're understandable.
  return label ? btn : <Hint label="Copy">{btn}</Hint>;
}
