import { browserProcedure } from "../procedures";
import { ServiceError } from "../../shared/errors";
import { identityRepository } from "../../repositories/identity";
import { publicUser } from "../../auth/views";
export const sessionProcedure = browserProcedure.query(({ ctx }) => {
  if (!identityRepository(ctx.db).anyWorkspace()) {
    throw new ServiceError(
      "PRECONDITION_FAILED",
      "Set up your workspace to continue.",
    );
  }
  return {
    is_authenticated: !!ctx.user,
    user: ctx.user ? publicUser(ctx.user) : null,
  };
});
