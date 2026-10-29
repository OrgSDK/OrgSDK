import { documents } from "../../db/schema";
import { inTransaction } from "../../db/transaction";
import { documentView } from "../../documents/views";
import { createDocumentSchema } from "../../documents/schemas";
import { recordAudit } from "../../repositories/audit";
import { base } from "../../shared/records";
import { text } from "../../shared/validation";
import { browserWorkspaceProcedure } from "../procedures";

export const createProcedure = browserWorkspaceProcedure
  .input(createDocumentSchema)
  .mutation(({ ctx, input }) =>
    inTransaction(ctx, (transaction) => {
      const document = transaction.db
        .insert(documents)
        .values({
          ...input,
          title: text(input.title, "title", 200),
          ...base(ctx.workspace.id),
        })
        .returning()
        .get();
      recordAudit(transaction, "document", document.id, "created");
      return documentView(document);
    }),
  );
