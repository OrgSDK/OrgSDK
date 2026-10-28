import { browser } from "../../domain/permissions";
import { accessTokensRepository } from "../../repositories/access-tokens";
import { tokenView } from "../../tokens/views";
import { page } from "../../shared/pagination";
import { protectedProcedure } from "../procedures";

export const listProcedure = protectedProcedure.query(({ ctx }) => {
  browser(ctx, true);
  return page(accessTokensRepository(ctx).list().map(tokenView));
});
