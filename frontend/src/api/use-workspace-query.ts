"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./result";
export function useWorkspaceQuery<T>(
  query: (signal: AbortSignal) => Promise<T>,
  pollMs = 0,
): {
  data: T | undefined;
  error: string;
  isLoading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [isLoading, setLoading] = useState(true);
  const request = useRef<AbortController | undefined>(undefined);
  const active = useRef(false);
  const refresh = useCallback(async (): Promise<void> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await query(controller.signal);
      if (controller.signal.aborted || !active.current) return;
      setData(next);
      setError("");
    } catch (error_) {
      if (!controller.signal.aborted && active.current)
        setError(errorMessage(error_));
    } finally {
      if (!controller.signal.aborted && active.current) setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    active.current = true;
    void (async () => {
      await refresh();
    })();
    const timer =
      pollMs > 0
        ? setInterval(() => {
            void refresh();
          }, pollMs)
        : undefined;
    return () => {
      active.current = false;
      request.current?.abort();
      clearInterval(timer);
    };
  }, [refresh, pollMs]);
  return { data, error, isLoading, refresh };
}
