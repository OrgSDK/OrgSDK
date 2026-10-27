import { useEffect, useState } from "react";
import { api } from "./client";
import type { components } from "./schema";

export type SessionState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; session: components["schemas"]["Session"] };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const { data, response } = await api.GET("/api/v1/session/", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!data || !response.ok) throw new Error("Session unavailable");
        setState({ status: "ready", session: data });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    }
    void load();
    return () => {
      controller.abort();
    };
  }, []);
  return state;
}
