import { eq } from "drizzle-orm";
import { documents } from "../../db/schema";
import { documentView } from "../../documents/views";
import { page } from "../../shared/pagination";
import { browserWorkspaceProcedure } from "../procedures";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const records = ctx.db
    .select()
    .from(documents)
    .where(eq(documents.workspaceId, ctx.workspace.id))
    .all();
  return page(records.map((record) => documentView(record)));
});
