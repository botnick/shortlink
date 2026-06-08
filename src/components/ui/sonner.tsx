import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/components/theme";

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      position="bottom-right"
      richColors
      closeButton
      {...props}
    />
  );
}
