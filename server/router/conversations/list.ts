import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { conversationsRepository } from "../../repositories/conversations";
import { conversationView } from "../../projects/conversations";
export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  return page(conversationsRepository(ctx).list().map(conversationView));
});
