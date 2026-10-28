import { browserProcedure } from "../procedures";
import { requireIdentityWorkspace } from "../../auth/context";
import { ServiceError } from "../../shared/errors";
export const createProcedure = browserProcedure.mutation(({ ctx }) => {
  requireIdentityWorkspace(ctx);
  throw new ServiceError(
    "FORBIDDEN",
    "Workspace provisioning is operator-managed.",
  );
});
