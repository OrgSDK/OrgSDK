import { tableQueries } from "../../tables/queries";
import { browser, tx, workspace } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { tableRowsRepository } from "../../repositories/table-rows";
import { deleteTableSchema } from "../../tables/schemas";
import { checkRevision } from "../../shared/validation";
import { projectsRepository } from "../../repositories/projects";
import { protectedProcedure } from "../procedures";

export const deleteProcedure = protectedProcedure
  .input(deleteTableSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx, true);
    return tx(ctx, (ctx) => {
      checkRevision(
        workspaceTablesRepository(ctx).find(input.id),
        input.revision,
      );
      for (const row of tableQueries(ctx.db, workspace(ctx)).rowsForTable(
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
      workspaceTablesRepository(ctx).remove(input.id);
      return { deleted: true };
    });
  });
