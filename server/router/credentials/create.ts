import { credentials } from "../../db/schema";
import { credentialPublicFields } from "../../credentials/queries";
import { inTransaction } from "../../db/transaction";
import { recordAudit } from "../../repositories/audit";
import { credentialCreateSchema } from "../../credentials/schemas";
import { base } from "../../shared/records";
import { browserManagerProcedure } from "../procedures";

export const createProcedure = browserManagerProcedure
  .input(credentialCreateSchema)
  .mutation(({ ctx, input }) => {
    const encryptedSecret = ctx.secrets.encrypt(JSON.stringify(input.secret));
    return inTransaction(ctx, (transaction) => {
      const credential = transaction.db
        .insert(credentials)
        .values({
          ...base(ctx.workspace.id),
          name: input.name,
          provider: input.provider,
          encryptedSecret,
        })
        .returning(credentialPublicFields)
        .get();
      recordAudit(transaction, "credential", credential.id, "created");
      return credential;
    });
  });
