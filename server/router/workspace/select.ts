import { browserProcedure } from "../procedures";
import { requireIdentityWorkspace } from "../../auth/context";
import { ServiceError } from "../../shared/errors";
import { membershipIdSchema } from "../../workspaces/schemas";
export const selectProcedure = browserProcedure
  .input(membershipIdSchema)
  .mutation(({ ctx }) => {
    requireIdentityWorkspace(ctx);
    throw new ServiceError(
      "FORBIDDEN",
      "Use the workspace domain to select a workspace.",
    );
  });
