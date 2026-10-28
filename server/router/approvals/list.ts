import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { page } from "../../shared/pagination";
import { approvalsRepository } from "../../repositories/approvals";
import { approvalView } from "../../runs/approvals";

export const listProcedure = protectedProcedure.query(({ ctx }) => {
  browser(ctx);
  return page(approvalsRepository(ctx).list().map(approvalView));
});
