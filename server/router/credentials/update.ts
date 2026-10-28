import { and, eq } from "drizzle-orm";
import { credentials } from "../../db/schema";
import { credentialPublicFields } from "../../credentials/queries";
import { inTransaction } from "../../db/transaction";
import { recordAudit } from "../../repositories/audit";
import { credentialChangesSchema } from "../../credentials/schemas";
import { ServiceError } from "../../shared/errors";
import { now } from "../../shared/records";
import { browserManagerProcedure } from "../procedures";

export const updateProcedure = browserManagerProcedure
  .input(credentialChangesSchema)
  .mutation(({ ctx, input }) => {
    const changes = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.secret === undefined
        ? {}
        : {
            encryptedSecret: ctx.secrets.encrypt(JSON.stringify(input.secret)),
          }),
    };
    return inTransaction(ctx, (transaction) => {
      const credential = transaction.db
        .update(credentials)
        .set({ ...changes, updatedAt: now() })
        .where(
          and(
            eq(credentials.workspaceId, ctx.workspace.id),
            eq(credentials.id, input.id),
          ),
        )
        .returning(credentialPublicFields)
        .get();
      if (!credential) {
        throw new ServiceError("NOT_FOUND", "Credential not found.");
      }
      recordAudit(transaction, "credential", credential.id, "updated");
      return credential;
    });
  });
