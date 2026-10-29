import { validateCodeSchema } from "../../runs/schemas";
import { scopedProcedure } from "../procedures";
import { createRun } from "../../runs/create";
import { serializeRun } from "../../runs/views";

export const validateCodeProcedure = scopedProcedure("actions:write")
  .input(validateCodeSchema)
  .mutation(({ ctx, input: body }) => {
    const run = createRun(ctx, { ...body, operation: "validate" });
    return serializeRun(run);
  });
