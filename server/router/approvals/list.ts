import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { approvalsRepository } from "../../repositories/approvals";
import { approvalView } from "../../runs/approvals";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  return page(approvalsRepository(ctx).list().map(approvalView));
});
