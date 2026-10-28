import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { page } from "../../shared/pagination";
import { conversationsRepository } from "../../repositories/conversations";
import { conversationView } from "../../projects/conversations";
export const listProcedure = protectedProcedure.query(({ ctx }) => {
  browser(ctx);
  return page(conversationsRepository(ctx).list().map(conversationView));
});
