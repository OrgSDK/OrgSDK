import { and, eq } from "drizzle-orm";
import { projects as projectRecords } from "../../db/schema";
import { scopedProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { projectVisibility } from "../../projects/queries";
import { serializeProject } from "../../projects/views";
export const listProcedure = scopedProcedure("catalog:read").query(
  ({ ctx }) => {
    const projects = ctx.db
      .select()
      .from(projectRecords)
      .where(
        and(
          eq(projectRecords.workspaceId, ctx.workspace.id),
          projectVisibility(ctx.db, ctx.workspace.id, ctx.token),
        ),
      )
      .all();
    return page(projects.map((project) => serializeProject(ctx, project)));
  },
);
