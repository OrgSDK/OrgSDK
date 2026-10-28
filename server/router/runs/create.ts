import { createRun } from "../../runs/create";
import { createRunSchema } from "../../runs/schemas";
import { serializeRun } from "../../runs/views";
import { protectedProcedure } from "../procedures";
export const createProcedure = protectedProcedure
  .input(createRunSchema)
  .mutation(({ ctx, input }) => {
    const run = createRun(ctx, input);
    return serializeRun(run);
  });
