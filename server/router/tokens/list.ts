import { accessTokensRepository } from "../../repositories/access-tokens";
import { tokenView } from "../../tokens/views";
import { page } from "../../shared/pagination";
import { browserManagerProcedure } from "../procedures";

export const listProcedure = browserManagerProcedure.query(({ ctx }) => {
  return page(accessTokensRepository(ctx).list().map(tokenView));
});
