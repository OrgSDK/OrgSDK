import { and, eq } from "drizzle-orm";
import { actions, projects as projectRecords, runs } from "../../db/schema";
import { recordAudit } from "../../repositories/audit";
import { browserManagerProcedure } from "../procedures";
import { tx } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { projectIdSchema } from "../../projects/schemas";
import { projectsRepository } from "../../repositories/projects";
export const deleteProcedure = browserManagerProcedure
  .input(projectIdSchema)
  .mutation(({ ctx, input }) => {
    tx(ctx, (transaction) => {
      const projects = projectsRepository(transaction);
      projects.find(input.id);
      const retainedRun = transaction.db
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.workspaceId, ctx.workspace.id),
            eq(runs.projectId, input.id),
          ),
        )
        .limit(1)
        .get();
      const retainedAction = transaction.db
        .select({ id: actions.id })
        .from(actions)
        .where(
          and(
            eq(actions.workspaceId, ctx.workspace.id),
            eq(actions.projectId, input.id),
          ),
        )
        .limit(1)
        .get();
      if (retainedRun || retainedAction) {
        throw new ServiceError(
          "CONFLICT",
          "Project has retained runs or actions.",
        );
      }
      const deleted = transaction.db
        .delete(projectRecords)
        .where(
          and(
            eq(projectRecords.workspaceId, ctx.workspace.id),
            eq(projectRecords.id, input.id),
          ),
        )
        .returning({ id: projectRecords.id })
        .get();
      if (deleted) {
        recordAudit(transaction, "project", input.id, "deleted");
      }
    });
  });
