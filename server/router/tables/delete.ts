import { and, eq } from "drizzle-orm";
import { workspaceTables } from "../../db/schema";
import { recordAudit } from "../../repositories/audit";
import { tableQueries } from "../../tables/queries";
import { tx } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { tableRowsRepository } from "../../repositories/table-rows";
import { deleteTableSchema } from "../../tables/schemas";
import { checkRevision } from "../../shared/validation";
import { projectsRepository } from "../../repositories/projects";
import { browserManagerProcedure } from "../procedures";

export const deleteProcedure = browserManagerProcedure
  .input(deleteTableSchema)
  .mutation(({ ctx, input }) => {
    return tx(ctx, (ctx) => {
      checkRevision(
        workspaceTablesRepository(ctx).find(input.id),
        input.revision,
      );
      for (const row of tableQueries(ctx.db, ctx.workspace.id).rowsForTable(
        input.id,
      )) {
        tableRowsRepository(ctx).remove(row.id);
      }
      for (const project of projectsRepository(ctx).list()) {
        projectsRepository(ctx).update(project.id, {
          readableTables: project.readableTables.filter(
            (value) => value !== input.id,
          ),
          writableTables: project.writableTables.filter(
            (value) => value !== input.id,
          ),
        });
      }
      const deleted = ctx.db
        .delete(workspaceTables)
        .where(
          and(
            eq(workspaceTables.workspaceId, ctx.workspace.id),
            eq(workspaceTables.id, input.id),
          ),
        )
        .returning({ id: workspaceTables.id })
        .get();
      if (deleted) {
        recordAudit(ctx, "table", input.id, "deleted");
      }
      return { deleted: true };
    });
  });
