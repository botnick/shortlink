import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** True for the "failed to fetch a code-split chunk" error that happens when a
 *  deploy rotates chunk hashes while a user still holds the old index.html. */
function isChunkLoadError(error: Error): boolean {
  return (
    /loading (chunk|css chunk|dynamically imported module)/i.test(error.message) ||
    error.name === "ChunkLoadError"
  );
}

/**
 * App-wide error boundary so a render throw — or a stale lazy-chunk import after
 * a deploy — shows a friendly recovery card instead of a blank white screen.
 * A chunk-load error reloads once automatically (the new index.html points at
 * the fresh hashes); a one-shot sessionStorage guard prevents a reload loop.
 */
const RELOAD_GUARD = "shortlink-chunk-reloaded";

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isChunkLoadError(error) && !sessionStorage.getItem(RELOAD_GUARD)) {
      sessionStorage.setItem(RELOAD_GUARD, "1");
      window.location.reload();
      return;
    }
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  private reset = () => {
    sessionStorage.removeItem(RELOAD_GUARD);
    window.location.assign("/");
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page hit an unexpected error. Reloading usually fixes it.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="outline" onClick={this.reset}>
            Go home
          </Button>
        </div>
      </div>
    );
  }
}
