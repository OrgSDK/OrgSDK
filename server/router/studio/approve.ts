import { z } from "zod";
import { browserWorkspaceProcedure } from "../procedures";
import { approveStudio } from "../../auth/studio";
import { ServiceError } from "../../shared/errors";
export const approve = browserWorkspaceProcedure
  .input(z.object({ challenge: z.string().regex(/^[0-9a-f]{64}$/) }).strict())
  .mutation(({ ctx, input }) => {
    if (
      ctx.studioOrigin ||
      !ctx.sessionId ||
      ctx.request.headers.get("origin") !== ctx.origin
    ) {
      throw new ServiceError(
        "FORBIDDEN",
        "Approve the dashboard on the installation.",
      );
    }
    return approveStudio(ctx.db, ctx.sessionId, ctx.origin, input.challenge);
  });
