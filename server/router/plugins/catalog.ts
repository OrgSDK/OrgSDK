import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { catalogEntries } from "../../plugins/catalog";
export const catalogProcedure = protectedProcedure.query(({ ctx }) => {
  browser(ctx);
  return catalogEntries();
});
