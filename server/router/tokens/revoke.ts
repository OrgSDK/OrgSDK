import { browser } from "../../domain/permissions";
import { accessTokensRepository } from "../../repositories/access-tokens";
import { inTransaction } from "../../db/transaction";
import { z } from "zod";
import { protectedProcedure } from "../procedures";

export const revokeProcedure = protectedProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .mutation(({ ctx, input }) => {
    return inTransaction(ctx, (ctx) => {
      browser(ctx, true);
      accessTokensRepository(ctx).find(input.id);
      accessTokensRepository(ctx).update(input.id, { revoked: true });
    });
  });
