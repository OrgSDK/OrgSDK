import { and, eq, inArray, or } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { actions, actionVersions, projects } from "../db/schema";

type ProjectGrants = { projects: string[]; actionVersions: string[] };

export function projectVisibility(
  database: AppDatabase,
  workspaceId: number,
  grants?: ProjectGrants | null,
) {
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
