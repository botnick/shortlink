import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type Confirm = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<Confirm>(() => Promise.resolve(false));

/** App-wide replacement for window.confirm — a styled, promise-based dialog. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = useCallback<Confirm>(
    (opts) => new Promise<boolean>((resolve) => setState({ opts, resolve })),
    [],
  );

  const settle = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog open={state !== null} onOpenChange={(o) => !o && settle(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{state?.opts.title}</DialogTitle>
            {state?.opts.description && (
              <DialogDescription>{state.opts.description}</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {state?.opts.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={state?.opts.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {state?.opts.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): Confirm {
  return useContext(ConfirmCtx);
}
