import { protectedProcedure } from "../procedures";
import { scope } from "../../domain/permissions";
import { requireWorkspace } from "../../shared/authorization";
import { page } from "../../shared/pagination";
import { projectQueries } from "../../projects/queries";
import { serializeProject } from "../../projects/views";
export const listProcedure = protectedProcedure.query(({ ctx }) => {
  scope(ctx, "catalog:read");
  const projects = projectQueries(ctx.db, requireWorkspace(ctx).id).listVisible(
    ctx.token,
  );
  return page(projects.map((project) => serializeProject(ctx, project)));
});
