import { approvalIdSchema } from "../../runs/approvals";
import { browserWorkspaceProcedure } from "../procedures";
import { approvalsRepository } from "../../repositories/approvals";
import { approvalView } from "../../runs/approvals";

export const getProcedure = browserWorkspaceProcedure
  .input(approvalIdSchema)
  .query(({ ctx, input }) => {
    const id = input.id;
    return approvalView(approvalsRepository(ctx).find(id));
  });
