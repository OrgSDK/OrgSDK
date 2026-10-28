import { browserProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { requireIdentity } from "../../auth/context";
import { assertCurrentUser } from "../../auth/sessions";
import { publicUser } from "../../auth/views";
import { updateAccount } from "../../auth/queries";
import { profileSchema } from "../../auth/schemas";
export const updateMeProcedure = browserProcedure
  .input(profileSchema)
  .mutation(({ ctx, input }) => {
    const user = requireIdentity(ctx);
    return inTransaction(ctx, (ctx) => {
      assertCurrentUser(ctx, user);
      const updated = updateAccount(ctx.db, user.id, {
        firstName: input.first_name ?? user.firstName,
        lastName: input.last_name ?? user.lastName,
      });
      return publicUser(updated);
    });
  });
