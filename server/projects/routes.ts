import {
  browser,
  isClient,
  projectGrant,
  scope,
  tx,
} from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { actionVersionsRepository } from "../repositories/action-versions";
import { actionsRepository } from "../repositories/actions";
import { projectsRepository } from "../repositories/projects";
import { runsRepository } from "../repositories/runs";
import { projectSnapshot } from "./snapshot";
import { projectValues } from "./validation";
import { serializeProject } from "./views";
export async function handleProjects(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "projects" || resource === "agents") {
    if (method === "GET") {
      scope(ctx, "catalog:read");
      if (id && sub === "sdk") {
        projectGrant(ctx, id);
        return json(projectSnapshot(ctx, id).sdk);
      }
      if (id && sub) throw new HttpError(405, "Operation is not implemented.");
      if (id) {
        const project = projectsRepository(ctx).find(id);
        if (
          isClient(ctx) &&
          ctx.token &&
          !ctx.token.projects.includes(id) &&
          !actionsRepository(ctx)
            .list()
            .some(
              (a) =>
                a.projectId === id &&
                actionVersionsRepository(ctx)
                  .list()
                  .some(
                    (v) =>
                      v.actionId === a.id &&
                      ctx.token!.actionVersions.includes(v.id),
                  ),
            )
        )
          throw new HttpError(404, "Not found.");
        return json(serializeProject(ctx, project));
      }
      return json(
        page(
          projectsRepository(ctx)
            .list()
            .filter(
              (p) =>
                !isClient(ctx) ||
                ctx.token!.projects.includes(p.id) ||
                actionsRepository(ctx)
                  .list()
                  .some(
                    (a) =>
                      a.projectId === p.id &&
                      actionVersionsRepository(ctx)
                        .list()
                        .some(
                          (v) =>
                            v.actionId === a.id &&
                            ctx.token!.actionVersions.includes(v.id),
                        ),
                  ),
            )
            .map((p) => serializeProject(ctx, p)),
        ),
      );
    }
    browser(ctx, true);
    if (sub) throw new HttpError(405, "Operation is not implemented.");
    if (method === "POST" && !id) {
      const data = projectValues(ctx, await body());
      const row = tx(ctx, () => {
        const p = projectsRepository(ctx).create(data);
        return p;
      });
      return json(serializeProject(ctx, row), 201);
    }
    if (id && (method === "PATCH" || method === "PUT")) {
      const old = projectsRepository(ctx).find(id);
      const data = projectValues(ctx, await body(), old);
      const row = tx(ctx, () => {
        const p = projectsRepository(ctx).update(id, data);
        return p;
      });
      return json(serializeProject(ctx, row));
    }
    if (id && method === "DELETE") {
      projectsRepository(ctx).find(id);
      if (
        runsRepository(ctx)
          .list()
          .some((r) => r.projectId === id) ||
        actionsRepository(ctx)
          .list()
          .some((a) => a.projectId === id)
      )
        throw new HttpError(409, "Project has retained runs or actions.");
      tx(ctx, () => {
        projectsRepository(ctx).remove(id);
      });
      return new Response(null, { status: 204 });
    }
  }
  return null;
}
