import { accessTokensRepository } from "../../repositories/access-tokens";
import { inTransaction } from "../../db/transaction";
import { z } from "zod";
import { browserManagerProcedure } from "../procedures";

export const revokeProcedure = browserManagerProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .mutation(({ ctx, input }) => {
    return inTransaction(ctx, (ctx) => {
      accessTokensRepository(ctx).find(input.id);
      accessTokensRepository(ctx).update(input.id, { revoked: true });
    });
  });
