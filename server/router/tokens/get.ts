import { browser } from "../../domain/permissions";
import { accessTokensRepository } from "../../repositories/access-tokens";
import { tokenView } from "../../tokens/views";
import { z } from "zod";
import { protectedProcedure } from "../procedures";

export const getProcedure = protectedProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .query(({ ctx, input }) => {
    browser(ctx, true);
    return tokenView(accessTokensRepository(ctx).find(input.id));
  });
