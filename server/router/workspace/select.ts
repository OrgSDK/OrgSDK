import { browserWorkspaceProcedure } from "../procedures";
import { ServiceError } from "../../shared/errors";
import { membershipIdSchema } from "../../workspaces/schemas";
export const selectProcedure = browserWorkspaceProcedure
  .input(membershipIdSchema)
  .mutation(() => {
    throw new ServiceError(
      "FORBIDDEN",
      "Use the workspace domain to select a workspace.",
    );
  });
