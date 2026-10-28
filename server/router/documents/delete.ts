import { tx } from "../../domain/permissions";
import { documentsRepository } from "../../repositories/documents";
import { documentIdSchema } from "../../documents/schemas";
import { projectsRepository } from "../../repositories/projects";
import { browserWorkspaceProcedure } from "../procedures";

export const deleteProcedure = browserWorkspaceProcedure
  .input(documentIdSchema)
  .mutation(({ ctx, input }) => {
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
