"use client";
import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDiscardConfirmation } from "./discard-dialog";
function currentHistoryEntry(): object | undefined {
  const navigation: unknown = Reflect.get(globalThis, "navigation");
  if (navigation === null || typeof navigation !== "object") return;
  const entry: unknown = Reflect.get(navigation, "currentEntry");
  return entry !== null && typeof entry === "object" ? entry : undefined;
}
function historyKey(): string | undefined {
  const entry = currentHistoryEntry();
  const key: unknown = entry ? Reflect.get(entry, "key") : undefined;
  return typeof key === "string" ? key : undefined;
}
function historyPosition(key?: string): number | undefined {
  let entry = currentHistoryEntry();
  const navigation: unknown = Reflect.get(globalThis, "navigation");
  if (key && navigation !== null && typeof navigation === "object") {
    const entries: unknown = Reflect.get(navigation, "entries");
    if (typeof entries === "function") {
      const historyEntries: unknown = Reflect.apply(entries, navigation, []);
      if (Array.isArray(historyEntries)) {
        const match: unknown = historyEntries.find(
          (item: unknown) =>
            item !== null &&
            typeof item === "object" &&
            Reflect.get(item, "key") === key,
        );
        if (match !== null && typeof match === "object") entry = match;
      }
    }
  }
  const index: unknown = entry ? Reflect.get(entry, "index") : undefined;
  return typeof index === "number" ? index : undefined;
}
export function useWorkspaceNavigation(isDirty: boolean): {
  navigateTo: (href: string) => Promise<void>;
} {
  const router = useRouter();
  const canDiscard = useDiscardConfirmation();
  const dirty = useRef(isDirty);
  useEffect(() => {
    dirty.current = isDirty;
  }, [isDirty]);
  const navigateTo = useCallback(
    async (href: string): Promise<void> => {
      if (href === `${location.pathname}${location.search}`) return;
      if (dirty.current && !(await canDiscard())) return;
      router.push(href);
    },
    [router, canDiscard],
  );
  useEffect(() => {
    let position = historyPosition();
    let currentKey = historyKey();
    let currentUrl = location.href;
    let currentState: unknown = history.state;
    let mode: "idle" | "restoring" | "allowing" = "idle";
    let traversal = 0;
    const updateCurrent = (): void => {
      position = historyPosition();
      currentKey = historyKey();
      currentUrl = location.href;
      currentState = history.state;
    };
    const onEntryChange = (event: Event): void => {
      const kind: unknown = Reflect.get(event, "navigationType");
      if (kind === "push" || kind === "replace") updateCurrent();
    };
    const onPopState = (event: PopStateEvent): void => {
      if (mode === "allowing") {
        mode = "idle";
        updateCurrent();
        return;
      }
      if (mode === "restoring") {
        event.stopImmediatePropagation();
        mode = "idle";
        void canDiscard().then((shouldDiscard) => {
          if (!shouldDiscard) return;
          mode = "allowing";
          history.go(traversal);
        });
        return;
      }
      if (!dirty.current) {
        updateCurrent();
        return;
      }
      event.stopImmediatePropagation();
      const destination = historyPosition();
      const origin = currentKey ? historyPosition(currentKey) : position;
      if (
        origin !== undefined &&
        destination !== undefined &&
        destination !== origin
      ) {
        // Restore the current entry before Next handles popstate, preserving the live draft.
        traversal = destination - origin;
        mode = "restoring";
        history.go(-traversal);
        return;
      }
      // Older browsers lack entry indices. Restore the current page before asking.
      const target = `${location.pathname}${location.search}`;
      history.pushState(currentState, "", currentUrl);
      void canDiscard().then((shouldDiscard) => {
        if (shouldDiscard) router.push(target);
      });
    };
    const navigation: unknown = Reflect.get(globalThis, "navigation");
    if (navigation instanceof EventTarget)
      navigation.addEventListener("currententrychange", onEntryChange);
    addEventListener("popstate", onPopState, { capture: true });
    return () => {
      removeEventListener("popstate", onPopState, { capture: true });
      if (navigation instanceof EventTarget)
        navigation.removeEventListener("currententrychange", onEntryChange);
    };
  }, [router, canDiscard]);
  return { navigateTo };
}
