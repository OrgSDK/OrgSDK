import { browser } from "../../domain/permissions";
import { documentsRepository } from "../../repositories/documents";
import { documentView } from "../../documents/views";
import { documentIdSchema } from "../../documents/schemas";
import { protectedProcedure } from "../procedures";

export const getProcedure = protectedProcedure
  .input(documentIdSchema)
  .query(({ ctx, input }) => {
    browser(ctx);
    return documentView(documentsRepository(ctx).find(input.id));
  });
