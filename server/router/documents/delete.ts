import { browser, tx } from "../../domain/permissions";
import { documentsRepository } from "../../repositories/documents";
import { documentIdSchema } from "../../documents/schemas";
import { projectsRepository } from "../../repositories/projects";
import { protectedProcedure } from "../procedures";

export const deleteProcedure = protectedProcedure
  .input(documentIdSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx);
    return tx(ctx, (ctx) => {
      documentsRepository(ctx).find(input.id);
      for (const project of projectsRepository(ctx).list()) {
        projectsRepository(ctx).update(project.id, {
          readableDocuments: project.readableDocuments.filter(
            (value) => value !== input.id,
          ),
          writableDocuments: project.writableDocuments.filter(
            (value) => value !== input.id,
          ),
        });
      }
      documentsRepository(ctx).remove(input.id);
      return { deleted: true };
    });
  });
