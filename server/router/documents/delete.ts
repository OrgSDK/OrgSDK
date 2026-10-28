import { and, eq } from "drizzle-orm";
import { documents } from "../../db/schema";
import { recordAudit } from "../../repositories/audit";
import { tx } from "../../domain/permissions";
import { findDocument } from "../../repositories/documents";
import { documentIdSchema } from "../../documents/schemas";
import { projectsRepository } from "../../repositories/projects";
import { browserWorkspaceProcedure } from "../procedures";

export const deleteProcedure = browserWorkspaceProcedure
  .input(documentIdSchema)
  .mutation(({ ctx, input }) => {
    return tx(ctx, (ctx) => {
      findDocument(ctx.db, ctx.workspace.id, input.id);
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
      const deleted = ctx.db
        .delete(documents)
        .where(
          and(
            eq(documents.workspaceId, ctx.workspace.id),
            eq(documents.id, input.id),
          ),
        )
        .returning({ id: documents.id })
        .get();
      if (deleted) {
        recordAudit(ctx, "document", input.id, "deleted");
      }
      return { deleted: true };
    });
  });
