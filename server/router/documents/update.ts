import { and, eq } from "drizzle-orm";
import { documents } from "../../db/schema";
import { now } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { ServiceError } from "../../shared/errors";
import { tx } from "../../domain/permissions";
import { findDocument } from "../../repositories/documents";
import { documentView } from "../../documents/views";
import { updateDocumentSchema } from "../../documents/schemas";
import { text } from "../../shared/validation";
import { browserWorkspaceProcedure } from "../procedures";

export const updateProcedure = browserWorkspaceProcedure
  .input(updateDocumentSchema)
  .mutation(({ ctx, input }) => {
    return tx(ctx, (ctx) => {
      const current = findDocument(ctx.db, ctx.workspace.id, input.id);
      const document = ctx.db
        .update(documents)
        .set({
          kind: input.kind ?? current.kind,
          title:
            input.title === undefined
              ? current.title
              : text(input.title, "title", 200),
          content: input.content ?? current.content,
          updatedAt: now(),
        })
        .where(
          and(
            eq(documents.workspaceId, ctx.workspace.id),
            eq(documents.id, input.id),
          ),
        )
        .returning()
        .get();
      if (!document) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      recordAudit(ctx, "document", document.id, "updated");
      return documentView(document);
    });
  });
