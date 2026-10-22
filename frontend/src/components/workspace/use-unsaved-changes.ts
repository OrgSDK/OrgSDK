"use client";
import { useEffect } from "react";
export function useUnsavedChanges(
  isDirty: boolean,
  onDirtyChange: (isDirty: boolean) => void,
): void {
  useEffect(() => {
    onDirtyChange(isDirty);
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    if (isDirty) addEventListener("beforeunload", preventUnload);
    return () => {
      removeEventListener("beforeunload", preventUnload);
      onDirtyChange(false);
    };
  }, [isDirty, onDirtyChange]);
}
