import { findDocument } from "../../repositories/documents";
import { documentView } from "../../documents/views";
import { documentIdSchema } from "../../documents/schemas";
import { browserWorkspaceProcedure } from "../procedures";

export const getProcedure = browserWorkspaceProcedure
  .input(documentIdSchema)
  .query(({ ctx, input }) => {
    return documentView(findDocument(ctx.db, ctx.workspace.id, input.id));
  });
