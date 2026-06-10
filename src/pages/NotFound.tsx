import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/Logo";

export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <BrandMark className="size-12 text-xl" />
      <h1 className="display mt-6 text-5xl">404</h1>
      <p className="mt-2 max-w-sm text-muted-foreground">
        This page doesn’t exist. Check the address, or head back home.
      </p>
      <Button asChild className="mt-6">
        <Link to="/">Back home</Link>
      </Button>
    </div>
  );
}
