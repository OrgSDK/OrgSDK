import { browser } from "../../domain/permissions";
import { documentsRepository } from "../../repositories/documents";
import { documentView } from "../../documents/views";
import { createDocumentSchema } from "../../documents/schemas";
import { text } from "../../shared/validation";
import { protectedProcedure } from "../procedures";

export const createProcedure = protectedProcedure
  .input(createDocumentSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx);
    return documentView(
      documentsRepository(ctx).create({
        ...input,
        title: text(input.title, "title", 200),
      }),
    );
  });
