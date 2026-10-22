"use client";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { api } from "../../api/client";
import { result, errorMessage } from "../../api/result";
import { loadAgents } from "../../api/workspace-queries";
import type { components } from "../../api/schema";
import { DiscardConfirmation } from "./discard-dialog";
import { useWorkspaceNavigation } from "./use-navigation";
import { WorkspaceShell } from "./shell";
import { projectHref, projectSwitchHref, workspaceView } from "./routes";
interface WorkspaceContextValue {
  agents: components["schemas"]["Project"][];
  selected: string;
  setSelected: (id: string) => void;
  switchProject: (id: string) => Promise<void>;
  workspace: string;
  role: string;
  canManage: boolean;
  isDirty: boolean;
  setDirty: (isDirty: boolean) => void;
  refresh: () => Promise<void>;
  goTo: (view: string) => void;
  openRun: (id: string) => void;
  navigateTo: (href: string) => Promise<void>;
}
const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined,
);
function rememberedProject(workspaceId: number): string | null {
  try {
    return sessionStorage.getItem(`orgsdk:project:v1:${String(workspaceId)}`);
  } catch {
    return null;
  }
}
export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context)
    throw new Error("Workspace screen must be inside the workspace layout.");
  return context;
}
function WorkspaceSession({ children }: { children: ReactNode }): ReactNode {
  const [signedIn, setSignedIn] = useState<boolean | undefined>();
  const [agents, setAgents] = useState<components["schemas"]["Project"][]>([]);
  const [selectedProject, setSelected] = useState("");
  const [workspace, setWorkspace] = useState("Your workspace");
  const [workspaceId, setWorkspaceId] = useState<number>();
  const [role, setRole] = useState("member");
  const [isDirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [resolvedDetail, setResolvedDetail] = useState("");
  const [detailError, setDetailError] = useState({ key: "", message: "" });
  const pathname = usePathname();
  const parameters = useSearchParams();
  const { navigateTo } = useWorkspaceNavigation(isDirty);
  const actionId = parameters.get("action");
  const runId = parameters.get("run");
  const actionKey = actionId ? `action:${actionId}` : "";
  const detailKey = runId ? `run:${runId}` : actionKey;
  const linkedProject =
    parameters.get("project") ??
    parameters.get("agent") ??
    (pathname.startsWith("/projects") || pathname.startsWith("/agents")
      ? parameters.get("record")
      : null);
  const isInvalidProject =
    signedIn === true &&
    !detailKey &&
    Boolean(linkedProject) &&
    agents.every((project) => project.id !== linkedProject);
  const selected = isInvalidProject ? "" : selectedProject;
  const currentDetailError =
    detailError.key === detailKey ? detailError.message : "";
  const selectionError = isInvalidProject
    ? "This project is unavailable. Choose another project from the sidebar."
    : currentDetailError;
  const refresh = useCallback(async (): Promise<void> => {
    const [list, response] = await Promise.all([
      loadAgents(new AbortController().signal),
      api.GET("/api/v1/workspaces/current/"),
    ]);
    const current = result(response);
    setAgents(list);
    setSelected((previous) => {
      const parameters = new URLSearchParams(location.search);
      const linked =
        parameters.get("project") ??
        parameters.get("agent") ??
        parameters.get("record");
      const candidates = [
        previous,
        linked,
        rememberedProject(current.workspace.id),
      ];
      for (const candidate of candidates) {
        if (candidate && list.some((project) => project.id === candidate))
          return candidate;
      }
      return list[0]?.id ?? "";
    });
    setWorkspace(current.workspace.name);
    setWorkspaceId(current.workspace.id);
    setRole(current.role);
  }, []);
  useEffect(() => {
    if (!selected || workspaceId === undefined) return;
    try {
      sessionStorage.setItem(
        `orgsdk:project:v1:${String(workspaceId)}`,
        selected,
      );
    } catch {
      // URL selection still works when browser storage is unavailable.
    }
  }, [selected, workspaceId]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const session = result(
          await api.GET("/api/v1/session/", { signal: controller.signal }),
        );
        if (controller.signal.aborted) return;
        if (session.is_authenticated) await refresh();
        controller.signal.throwIfAborted();
        setSignedIn(session.is_authenticated);
      } catch (error_) {
        if (!controller.signal.aborted) setError(errorMessage(error_));
      }
    })();
    return () => {
      controller.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (signedIn !== true) return;
    const controller = new AbortController();
    const choose = (id: string | undefined) => {
      if (controller.signal.aborted) return;
      if (!id || agents.every((project) => project.id !== id))
        throw new Error(
          "This record's project is unavailable. Choose another project from the sidebar.",
        );
      setSelected(id);
    };
    if (actionId || runId) {
      void (async () => {
        try {
          if (runId) {
            const record = result(
              await api.GET("/api/v1/runs/{id}/", {
                signal: controller.signal,
                params: { path: { id: runId } },
              }),
            );
            choose(record.project);
          } else if (actionId) {
            const record = result(
              await api.GET("/api/v1/actions/{id}/", {
                signal: controller.signal,
                params: { path: { id: actionId } },
              }),
            );
            choose(record.project ?? record.agent);
          }
          if (!controller.signal.aborted)
            setDetailError({ key: detailKey, message: "" });
        } catch (error_) {
          if (!controller.signal.aborted)
            setDetailError({ key: detailKey, message: errorMessage(error_) });
        } finally {
          if (!controller.signal.aborted) setResolvedDetail(detailKey);
        }
      })();
    } else if (linkedProject && !isInvalidProject) choose(linkedProject);
    return () => {
      controller.abort();
    };
  }, [
    agents,
    linkedProject,
    isInvalidProject,
    actionId,
    runId,
    detailKey,
    signedIn,
  ]);
  const value: WorkspaceContextValue = {
    agents,
    selected,
    setSelected,
    switchProject: async (id) => {
      if (agents.every((project) => project.id !== id)) return;
      await navigateTo(projectSwitchHref(workspaceView(pathname), id));
    },
    workspace,
    role,
    canManage: role === "owner" || role === "admin",
    isDirty,
    setDirty,
    refresh,
    goTo: (view) => {
      void navigateTo(projectHref(view, selected));
    },
    openRun: (id) => {
      void navigateTo(projectHref("runs", selected, id));
    },
    navigateTo,
  };
  return (
    <WorkspaceContext value={value}>
      <WorkspaceShell workspace={workspace} tab={workspaceView(pathname)}>
        {error || selectionError ? (
          <div className="error" role="alert">
            {error || selectionError}
          </div>
        ) : undefined}
        {signedIn === undefined ? (
          <p role="status">Loading your workspace…</p>
        ) : undefined}
        {signedIn === true &&
        !selectionError &&
        (!detailKey || detailKey === resolvedDetail)
          ? children
          : undefined}
        {signedIn === true && detailKey && detailKey !== resolvedDetail ? (
          <p role="status">Loading project…</p>
        ) : undefined}
        {signedIn === false ? (
          <section className="empty">
            <h2>Welcome to your workspace</h2>
            <p>Sign in to manage projects, run actions and review results.</p>
            <a
              className="button"
              href={`/accounts/login/?next=${encodeURIComponent(pathname)}`}
            >
              Sign in
            </a>
          </section>
        ) : undefined}
      </WorkspaceShell>
    </WorkspaceContext>
  );
}
export function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <DiscardConfirmation>
      <Suspense fallback={<p role="status">Loading workspace…</p>}>
        <WorkspaceSession>{children}</WorkspaceSession>
      </Suspense>
    </DiscardConfirmation>
  );
}
