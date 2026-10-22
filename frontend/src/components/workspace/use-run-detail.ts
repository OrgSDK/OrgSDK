"use client";
import { useCallback, useEffect } from "react";
import { api } from "../../api/client";
import { result } from "../../api/result";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import type { components } from "../../api/schema";
import { activeStatuses, type Run } from "./run-display";
interface RunData {
  run: Run;
  events: components["schemas"]["Event"][];
}
export function useRunDetail(
  id: string,
): ReturnType<typeof useWorkspaceQuery<RunData>> {
  const load = useCallback(
    async (signal: AbortSignal): Promise<RunData> => {
      const [run, events] = await Promise.all([
        api.GET("/api/v1/runs/{id}/", { signal, params: { path: { id } } }),
        api.GET("/api/v1/runs/{id}/events/", {
          signal,
          params: { path: { id } },
        }),
      ]);
      return { run: result(run), events: result(events) };
    },
    [id],
  );
  const query = useWorkspaceQuery(load, 3000);
  const status = query.data?.run.status;
  const { refresh } = query;
  useEffect(() => {
    if (!status || !activeStatuses.includes(status)) return;
    const stream = new EventSource(`/api/v1/runs/${id}/stream/`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (): void => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, 400);
    };
    stream.addEventListener("message", update);
    stream.addEventListener("complete", () => {
      stream.close();
      clearTimeout(timer);
      void refresh();
    });
    return () => {
      clearTimeout(timer);
      stream.close();
    };
  }, [id, status, refresh]);
  return { ...query, data: query.data?.run.id === id ? query.data : undefined };
}
