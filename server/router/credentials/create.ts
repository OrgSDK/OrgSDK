import { credentialQueries } from "../../credentials/queries";
import { inTransaction } from "../../db/transaction";
import { recordAudit } from "../../repositories/audit";
import { credentialCreateSchema } from "../../credentials/schemas";
import { browserManagerProcedure } from "../procedures";

export const createProcedure = browserManagerProcedure
  .input(credentialCreateSchema)
  .mutation(({ ctx, input }) => {
    const workspaceId = ctx.workspace.id;
    const encryptedSecret = ctx.secrets.encrypt(JSON.stringify(input.secret));
    return inTransaction(ctx, (ctx) => {
      const credential = credentialQueries(ctx.db, workspaceId).create({
        name: input.name,
        provider: input.provider,
        encryptedSecret,
      });
      recordAudit(ctx, "credential", credential.id, "created");
      return credential;
    });
  });
