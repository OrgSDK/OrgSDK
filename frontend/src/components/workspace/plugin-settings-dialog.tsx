import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/button";

export function PluginSettingsDialog({
  title,
  isBusy,
  onClose,
  restoreFocus,
  children,
}: {
  title: string;
  isBusy: boolean;
  onClose: () => void;
  restoreFocus: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-4 text-foreground shadow-lg sm:p-6"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <header className="mb-4 flex items-start justify-between gap-3">
            <Dialog.Title asChild>
              <h2 className="m-0 break-all">{title}</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Close plugin settings" disabled={isBusy}>
                <X size={18} aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
