import type { ServiceContext } from "../application";
import { projectGrant } from "../domain/permissions";
import { projectsRepository } from "../repositories/projects";
import { text } from "../shared/validation";

export function authoringProject(
  ctx: ServiceContext,
  body: { project: string },
) {
  const projectId = text(body.project, "project");
  projectsRepository(ctx).find(projectId);
  projectGrant(ctx, projectId);
  return projectId;
}
