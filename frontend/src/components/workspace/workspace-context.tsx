"use client";
import { loadSession, trpc } from "../../api/trpc";
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
import { redirectToSignIn } from "../../api/auth";
import { errorMessage } from "../../api/result";
import { loadProjects } from "../../api/workspace-queries";
import type { Project } from "../../api/types";
import { DiscardConfirmation } from "./discard-dialog";
import { useWorkspaceNavigation } from "./use-navigation";
import { WorkspaceShell } from "./shell";
import { projectHref, projectSwitchHref, workspaceView } from "./routes";
interface WorkspaceContextValue {
  projects: Project[];
  selected: string;
  setSelected: (id: string) => void;
  switchProject: (id: string) => Promise<void>;
  workspace: string;
  role: string;
  canManage: boolean;
  isDirty: boolean;
  setDirty: (isDirty: boolean) => void;
  refresh: (signal?: AbortSignal) => Promise<void>;
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
  const [signedIn, setSignedIn] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
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
    (pathname.startsWith("/projects") ? parameters.get("record") : null);
  const isInvalidProject =
    signedIn &&
    !detailKey &&
    Boolean(linkedProject) &&
    projects.every((project) => project.id !== linkedProject);
  const selected = isInvalidProject ? "" : selectedProject;
  const currentDetailError =
    detailError.key === detailKey ? detailError.message : "";
  const selectionError = isInvalidProject
    ? "This project is unavailable. Choose another project from the sidebar."
    : currentDetailError;
  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const [list, current] = await Promise.all([
      loadProjects(signal ?? new AbortController().signal),
      trpc.workspace.current.query(undefined, signal ? { signal } : undefined),
    ]);
    if (signal?.aborted) return;
    setProjects(list);
    setSelected((previous) => {
      const parameters = new URLSearchParams(location.search);
      const linked = parameters.get("project") ?? parameters.get("record");
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
    setRole(current.role ?? "member");
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
        const session = await loadSession(controller.signal);
        if (controller.signal.aborted) return;
        if (!session.is_authenticated) {
          redirectToSignIn();
          return;
        }
        await refresh(controller.signal);
        controller.signal.throwIfAborted();
        setSignedIn(true);
      } catch (error_) {
        if (!controller.signal.aborted) setError(errorMessage(error_));
      }
    })();
    return () => {
      controller.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    const choose = (id: string | undefined) => {
      if (controller.signal.aborted) return;
      if (!id || projects.every((project) => project.id !== id))
        throw new Error(
          "This record's project is unavailable. Choose another project from the sidebar.",
        );
      setSelected(id);
    };
    if (actionId || runId) {
      void (async () => {
        try {
          if (runId) {
            const record = await trpc.runs.get.query(
              { id: runId },
              { signal: controller.signal },
            );
            choose(record.project);
          } else if (actionId) {
            const record = await trpc.actions.get.query(
              { id: actionId },
              { signal: controller.signal },
            );
            choose(record.project);
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
    projects,
    linkedProject,
    isInvalidProject,
    actionId,
    runId,
    detailKey,
    signedIn,
  ]);
  if (!signedIn)
    return (
      <main className="p-6">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status">Loading your session…</p>
        )}
      </main>
    );
  const value: WorkspaceContextValue = {
    projects,
    selected,
    setSelected,
    switchProject: async (id) => {
      if (projects.every((project) => project.id !== id)) return;
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
        {!selectionError && (!detailKey || detailKey === resolvedDetail)
          ? children
          : undefined}
        {detailKey && detailKey !== resolvedDetail ? (
          <p role="status">Loading project…</p>
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
