import { createRun } from "../../runs/create";
import { sessionRunSchema } from "../../runs/schemas";
import { serializeRun } from "../../runs/views";
import { scopedProcedure } from "../procedures";

export const sessionProcedure = scopedProcedure("code:execute")
  .input(sessionRunSchema)
  .mutation(({ ctx, input }) =>
    serializeRun(createRun(ctx, { ...input, operation: "session" })),
  );
