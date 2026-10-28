import { requireCredentialAccess } from "../../credentials/access";
import { credentialQueries } from "../../credentials/queries";
import { inTransaction } from "../../db/transaction";
import { recordAudit } from "../../repositories/audit";
import { credentialCreateSchema } from "../../credentials/schemas";
import { protectedProcedure } from "../procedures";

export const createProcedure = protectedProcedure
  .input(credentialCreateSchema)
  .mutation(({ ctx, input }) => {
    const workspaceId = requireCredentialAccess(ctx, true);
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
