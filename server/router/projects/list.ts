import { scopedProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { projectQueries } from "../../projects/queries";
import { serializeProject } from "../../projects/views";
export const listProcedure = scopedProcedure("catalog:read").query(
  ({ ctx }) => {
    const projects = projectQueries(ctx.db, ctx.workspace.id).listVisible(
      ctx.token,
    );
    return page(projects.map((project) => serializeProject(ctx, project)));
  },
);
