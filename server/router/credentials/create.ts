import { insertCredential } from "../../credentials/create";
import { inTransaction } from "../../db/transaction";
import { credentialCreateSchema } from "../../credentials/schemas";
import { browserManagerProcedure } from "../procedures";

export const createProcedure = browserManagerProcedure
  .input(credentialCreateSchema)
  .mutation(({ ctx, input }) =>
    inTransaction(ctx, (transaction) => insertCredential(transaction, input)),
  );
