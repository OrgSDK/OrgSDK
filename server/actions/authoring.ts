import type { ServiceContext } from "../application";
import { authoringGrant } from "../domain/permissions";
import { projectsRepository } from "../repositories/projects";
import { text } from "../shared/validation";

export function authoringProject(
  ctx: ServiceContext,
  body: { project: string },
) {
  const projectId = text(body.project, "project");
  projectsRepository(ctx).find(projectId);
  authoringGrant(ctx, projectId);
  return projectId;
}
