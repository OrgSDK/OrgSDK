import { browser, tx } from "../../domain/permissions";
import { documentsRepository } from "../../repositories/documents";
import { documentView } from "../../documents/views";
import { updateDocumentSchema } from "../../documents/schemas";
import { text } from "../../shared/validation";
import { protectedProcedure } from "../procedures";

export const updateProcedure = protectedProcedure
  .input(updateDocumentSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx);
    return tx(ctx, (ctx) => {
      const current = documentsRepository(ctx).find(input.id);
      return documentView(
        documentsRepository(ctx).update(input.id, {
          kind: input.kind ?? current.kind,
          title:
            input.title === undefined
              ? current.title
              : text(input.title, "title", 200),
          content: input.content ?? current.content,
        }),
      );
    });
  });
