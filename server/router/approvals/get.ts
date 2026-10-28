import { approvalIdSchema } from "../../runs/approvals";
import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { approvalsRepository } from "../../repositories/approvals";
import { approvalView } from "../../runs/approvals";

export const getProcedure = protectedProcedure
  .input(approvalIdSchema)
  .query(({ ctx, input }) => {
    const id = input.id;

    browser(ctx);
    return approvalView(approvalsRepository(ctx).find(id));
  });
