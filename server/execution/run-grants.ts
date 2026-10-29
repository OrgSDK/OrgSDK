import { and, eq } from "drizzle-orm";
import { projects } from "../db/schema";
import { type ServiceContext } from "../application";
import { snapshotAgents } from "../projects/snapshot-schema";
import type { Run } from "./authority";

export function grantIds(
  context: ServiceContext,
  run: Run,
  kind: "tables" | "documents",
  write = false,
): string[] {
  const root = snapshotAgents(run.snapshot).find(
    (agent) => agent.id === run.projectId,
  );
  const grants = root?.resources?.[kind];
  const immutable = [
    ...(grants?.write ?? []),
    ...(write ? [] : (grants?.read ?? [])),
  ];
  const project = context.db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, run.projectId),
        eq(projects.workspaceId, run.workspaceId),
      ),
    )
    .get();
  if (!project) {
    return [];
  }

  const writable =
    kind === "tables" ? project.writableTables : project.writableDocuments;
  const readable =
    kind === "tables" ? project.readableTables : project.readableDocuments;
  const current = new Set([...writable, ...(write ? [] : readable)]);
  return immutable.filter((resourceId) => current.has(resourceId));
}
