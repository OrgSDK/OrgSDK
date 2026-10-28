import { eq } from "drizzle-orm";
import { workspaceTables } from "../../db/schema";
import { standard } from "../../tables/views";
import { page } from "../../shared/pagination";
import { browserWorkspaceProcedure } from "../procedures";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const records = ctx.db
    .select()
    .from(workspaceTables)
    .where(eq(workspaceTables.workspaceId, ctx.workspace.id))
    .all();
  return page(records.map((record) => standard(record)));
});
