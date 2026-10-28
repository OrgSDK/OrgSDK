import { browserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { assertCurrentUser } from "../../auth/sessions";
import { requireIdentityManager } from "../../auth/context";
import { ServiceError } from "../../shared/errors";
import { membershipForUser, renameWorkspace } from "../../workspaces/queries";
import { workspaceNameSchema } from "../../workspaces/schemas";
export const updateProcedure = browserProcedure
  .input(workspaceNameSchema)
  .mutation(({ ctx, input }) => {
    const name = input.name;
    const workspace = requireIdentityManager(ctx);
    const user = ctx.user!;
    return inTransaction(ctx, (ctx) => {
      assertCurrentUser(ctx, user);
      const actor = membershipForUser(ctx.db, workspace.id, user.id);
      if (!actor || !["owner", "admin"].includes(actor.role)) {
        throw new ServiceError(
          "FORBIDDEN",
          "Only workspace owners and admins can manage this workspace.",
        );
      }
      const updated = renameWorkspace(ctx.db, workspace.id, name.trim());
      return { id: updated.id, name: updated.name };
    });
  });
