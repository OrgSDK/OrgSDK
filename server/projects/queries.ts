import { and, eq, inArray, or } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import {
  actions,
  actionVersions,
  approvals,
  executors,
  projects,
  runs,
} from "../db/schema";

type ProjectGrants = { projects: string[]; actionVersions: string[] };

export function projectQueries(database: AppDatabase, workspaceId: number) {
  function visibility(grants?: ProjectGrants | null) {
    if (!grants) {
      return undefined;
    }
    const grantedActionProjects = database
      .select({ projectId: actions.projectId })
      .from(actions)
      .innerJoin(
        actionVersions,
        and(
          eq(actionVersions.actionId, actions.id),
          eq(actionVersions.workspaceId, workspaceId),
        ),
      )
      .where(
        and(
          eq(actions.workspaceId, workspaceId),
          inArray(actionVersions.id, grants.actionVersions),
        ),
      );
    return or(
      inArray(projects.id, grants.projects),
      inArray(projects.id, grantedActionProjects),
    );
  }
  return {
    executorForProject(projectId: string) {
      return database
        .select()
        .from(executors)
        .where(
          and(
            eq(executors.workspaceId, workspaceId),
            eq(executors.projectId, projectId),
          ),
        )
        .get();
    },
    activeRunsForExecutor(executorId: string) {
      return database
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.workspaceId, workspaceId),
            eq(runs.executorId, executorId),
            inArray(runs.status, ["running", "waiting_approval"]),
          ),
        )
        .all();
    },
    pendingApprovalsForRun(runId: string) {
      return database
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.workspaceId, workspaceId),
            eq(approvals.runId, runId),
            eq(approvals.status, "pending"),
          ),
        )
        .all();
    },
    listVisible(grants?: ProjectGrants | null) {
      return database
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), visibility(grants)))
        .all();
    },
    findVisible(id: string, grants?: ProjectGrants | null) {
      return database
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            eq(projects.id, id),
            visibility(grants),
          ),
        )
        .get();
    },
    hasRetainedResources(projectId: string) {
      const retainedRun = database
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(eq(runs.workspaceId, workspaceId), eq(runs.projectId, projectId)),
        )
        .limit(1)
        .get();
      if (retainedRun) {
        return true;
      }
      return (
        database
          .select({ id: actions.id })
          .from(actions)
          .where(
            and(
              eq(actions.workspaceId, workspaceId),
              eq(actions.projectId, projectId),
            ),
          )
          .limit(1)
          .get() !== undefined
      );
    },
  };
}
