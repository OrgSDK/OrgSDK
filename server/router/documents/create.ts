import { documentsRepository } from "../../repositories/documents";
import { documentView } from "../../documents/views";
import { createDocumentSchema } from "../../documents/schemas";
import { text } from "../../shared/validation";
import { browserWorkspaceProcedure } from "../procedures";

export const createProcedure = browserWorkspaceProcedure
  .input(createDocumentSchema)
  .mutation(({ ctx, input }) => {
    return documentView(
      documentsRepository(ctx).create({
        ...input,
        title: text(input.title, "title", 200),
      }),
    );
  });
