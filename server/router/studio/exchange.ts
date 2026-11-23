import { z } from "zod";
import { publicProcedure } from "../procedures";
import { exchangeStudio } from "../../auth/studio";
import { ServiceError } from "../../shared/errors";
export const exchange = publicProcedure
  .input(
    z
      .object({ code: z.string().length(43), verifier: z.string().length(64) })
      .strict(),
  )
  .mutation(({ ctx, input }) => {
    if (!ctx.studioOrigin) {
      throw new ServiceError("FORBIDDEN", "Open the configured dashboard.");
    }
    return exchangeStudio(
      ctx.db,
      ctx.origin,
      ctx.studioOrigin,
      input.code,
      input.verifier,
    );
  });
