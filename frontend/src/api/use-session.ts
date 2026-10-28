import { useEffect, useState } from "react";
import { loadSession } from "./trpc";

export type SessionState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; session: Awaited<ReturnType<typeof loadSession>> };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const session = await loadSession(controller.signal);
        if (!controller.signal.aborted) setState({ status: "ready", session });
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
