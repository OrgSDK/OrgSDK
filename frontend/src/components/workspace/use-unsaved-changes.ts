"use client";
import { useEffect } from "react";

const unload = { hasConfirmedDiscard: false };

export function leaveWorkspaceAfterConfirmation(href?: string): void {
  // The user has already confirmed in Studio's discard dialog.
  unload.hasConfirmedDiscard = true;
  addEventListener(
    "pageshow",
    () => {
      unload.hasConfirmedDiscard = false;
    },
    { once: true },
  );
  if (href) location.replace(href);
  else location.reload();
}

export function useUnsavedChanges(
  isDirty: boolean,
  onDirtyChange: (isDirty: boolean) => void,
): void {
  useEffect(() => {
    onDirtyChange(isDirty);
    const preventUnload = (event: BeforeUnloadEvent): void => {
      if (!unload.hasConfirmedDiscard) event.preventDefault();
    };
    if (isDirty) addEventListener("beforeunload", preventUnload);
    return () => {
      removeEventListener("beforeunload", preventUnload);
      onDirtyChange(false);
    };
  }, [isDirty, onDirtyChange]);
}
