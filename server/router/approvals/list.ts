import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { eq } from "drizzle-orm";
import { approvals } from "../../db/schema";
import { approvalView } from "../../runs/approvals";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const workspaceApprovals = ctx.db
    .select()
    .from(approvals)
    .where(eq(approvals.workspaceId, ctx.workspace.id))
    .all();
  return page(workspaceApprovals.map(approvalView));
});
