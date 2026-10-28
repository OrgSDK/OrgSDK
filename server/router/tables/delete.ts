import { and, eq } from "drizzle-orm";
import { workspaceTables } from "../../db/schema";
import { recordAudit } from "../../repositories/audit";
import { rowsForTable } from "../../tables/queries";
import { tx } from "../../domain/permissions";
import { findWorkspaceTable } from "../../repositories/workspace-tables";
import { removeTableRow } from "../../repositories/table-rows";
import { deleteTableSchema } from "../../tables/schemas";
import { checkRevision } from "../../shared/validation";
import { projectsRepository } from "../../repositories/projects";
import { browserManagerProcedure } from "../procedures";

export const deleteProcedure = browserManagerProcedure
  .input(deleteTableSchema)
  .mutation(({ ctx, input }) => {
    return tx(ctx, (ctx) => {
      checkRevision(
        findWorkspaceTable(ctx.db, ctx.workspace.id, input.id),
        input.revision,
      );
      for (const row of rowsForTable(ctx.db, ctx.workspace.id, input.id)) {
        removeTableRow(ctx, row.id);
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
