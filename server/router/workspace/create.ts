import { browserWorkspaceProcedure } from "../procedures";
import { ServiceError } from "../../shared/errors";
export const createProcedure = browserWorkspaceProcedure.mutation(() => {
  throw new ServiceError(
    "FORBIDDEN",
    "Workspace provisioning is operator-managed.",
  );
});
