import { browserProcedure } from "../procedures";
import { identityContext } from "../identity-context";
import { authState } from "../../auth/views";
import { removeSession } from "../../auth/queries";
export const logoutProcedure = browserProcedure.mutation(
  ({ ctx: requestContext }) => {
    const ctx = identityContext(requestContext);

    if (ctx.sessionId) {
      removeSession(ctx.db, ctx.sessionId);
    }
    ctx.sessionId = null;
    ctx.user = null;
    ctx.sessionChanged(null);
    return authState(ctx);
  },
);
