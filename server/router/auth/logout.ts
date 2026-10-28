import { browserProcedure } from "../procedures";
import { identityContext } from "../identity-context";
import { authState } from "../../auth/views";
import { eq } from "drizzle-orm";
import { sessions } from "../../db/schema/core";
export const logoutProcedure = browserProcedure.mutation(
  ({ ctx: requestContext }) => {
    const ctx = identityContext(requestContext);

    if (ctx.sessionId) {
      ctx.db.delete(sessions).where(eq(sessions.id, ctx.sessionId)).run();
    }
    ctx.sessionId = null;
    ctx.user = null;
    ctx.sessionChanged(null);
    return authState(ctx);
  },
);
