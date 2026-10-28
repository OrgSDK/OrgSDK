import { documentsRepository } from "../../repositories/documents";
import { documentView } from "../../documents/views";
import { documentIdSchema } from "../../documents/schemas";
import { browserWorkspaceProcedure } from "../procedures";

export const getProcedure = browserWorkspaceProcedure
  .input(documentIdSchema)
  .query(({ ctx, input }) => {
    return documentView(documentsRepository(ctx).find(input.id));
  });
