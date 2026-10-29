"use client";
import { useCallback, useEffect } from "react";
import { trpc } from "../../api/trpc";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import type { Run, RunEvent } from "../../api/types";
import { subscribeToRunUpdates } from "./run-subscription";
interface RunData {
  run: Run;
  events: RunEvent[];
}
export function useRunDetail(
  id: string,
): ReturnType<typeof useWorkspaceQuery<RunData>> {
  const load = useCallback(
    async (signal: AbortSignal): Promise<RunData> => {
      const [run, events] = await Promise.all([
        trpc.runs.get.query({ id }, { signal }),
        trpc.runs.events.query({ id }, { signal }),
      ]);
      return { run, events };
    },
    [id],
  );
  const query = useWorkspaceQuery(load, 3000);
  const current = query.data?.run.id === id ? query.data : undefined;
  const hasRun = current !== undefined;
  const { refresh } = query;
  useEffect(() => {
    if (!hasRun) return;
    // Polling can see completion before the stream delivers its final events.
    return subscribeToRunUpdates(id, refresh);
  }, [id, hasRun, refresh]);
  return { ...query, data: current };
}
