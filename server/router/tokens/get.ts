import { accessTokensRepository } from "../../repositories/access-tokens";
import { tokenView } from "../../tokens/views";
import { z } from "zod";
import { browserManagerProcedure } from "../procedures";

export const getProcedure = browserManagerProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .query(({ ctx, input }) => {
    return tokenView(accessTokensRepository(ctx).find(input.id));
  });
