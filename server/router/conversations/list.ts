import { eq } from "drizzle-orm";
import { conversations } from "../../db/schema";
import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { conversationView } from "../../projects/conversations";
export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const records = ctx.db
    .select()
    .from(conversations)
    .where(eq(conversations.workspaceId, ctx.workspace.id))
    .all();
  return page(records.map((record) => conversationView(record)));
});
