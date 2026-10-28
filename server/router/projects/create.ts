import { projects } from "../../db/schema";
import { base } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { browserManagerProcedure } from "../procedures";
import { tx } from "../../domain/permissions";
import { projectCreateSchema } from "../../projects/schemas";
import { projectValues } from "../../projects/validation";
import { serializeProject } from "../../projects/views";
export const createProcedure = browserManagerProcedure
  .input(projectCreateSchema)
  .mutation(({ ctx, input }) => {
    return tx(ctx, (transaction) => {
      const values = projectValues(transaction, input);
      const project = transaction.db
        .insert(projects)
        .values({ ...values, ...base(ctx.workspace.id) })
        .returning()
        .get();
      recordAudit(transaction, "project", project.id, "created");
      return serializeProject(transaction, project);
    });
  });
