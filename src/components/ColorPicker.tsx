import { useEffect, useState, type ReactNode } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { Pipette } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const EyeDropper =
  typeof window !== "undefined"
    ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
    : undefined;

function useIsDesktop() {
  const [desktop, setDesktop] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 640px)").matches,
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 640px)");
    const onChange = () => setDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

function PickerBody({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (v: string) => void;
  presets?: string[];
}) {
  async function pickFromScreen() {
    if (!EyeDropper) return;
    try {
      const result = await new EyeDropper().open();
      onChange(result.sRGBHex);
    } catch {
      /* cancelled */
    }
  }

  return (
    <div className="space-y-3">
      <HexColorPicker
        color={value}
        onChange={onChange}
        style={{ width: "100%", height: 200 }}
      />
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-md border bg-background pl-2.5">
          <span className="text-sm text-muted-foreground">#</span>
          <HexColorInput
            color={value}
            onChange={onChange}
            className="h-10 w-full bg-transparent px-1.5 font-mono text-sm uppercase outline-none"
          />
        </div>
        {EyeDropper && (
          <button
            type="button"
            onClick={pickFromScreen}
            title="Pick a color from the screen"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border hover:bg-accent"
          >
            <Pipette className="size-4" />
          </button>
        )}
      </div>
      {presets && presets.length > 0 && (
        <div className="grid grid-cols-9 gap-1.5">
          {presets.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              title={c}
              className={cn(
                "aspect-square rounded-md border transition-transform hover:scale-110",
                value.toLowerCase() === c.toLowerCase() &&
                  "ring-2 ring-ring ring-offset-1 ring-offset-popover",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (v: string) => void;
  presets?: string[];
}) {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);

  const trigger: ReactNode = (
    <button
      type="button"
      className="flex w-fit items-center gap-2.5 rounded-lg border bg-background py-1.5 pl-1.5 pr-3 shadow-sm transition-colors hover:bg-accent"
    >
      <span
        className="size-6 shrink-0 rounded-md shadow-sm ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: value }}
      />
      <span className="font-mono text-sm font-medium tabular-nums text-foreground">
        {value.toUpperCase()}
      </span>
    </button>
  );

  if (desktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          <PickerBody value={value} onChange={onChange} presets={presets} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xs gap-4">
        <DialogHeader>
          <DialogTitle className="text-base">Pick a color</DialogTitle>
        </DialogHeader>
        <PickerBody value={value} onChange={onChange} presets={presets} />
        <Button className="w-full" onClick={() => setOpen(false)}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}
