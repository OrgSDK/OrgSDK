import { validateCodeSchema } from "../../runs/schemas";
import { protectedProcedure } from "../procedures";
import { createRun } from "../../runs/create";
import { serializeRun } from "../../runs/views";

export const validateCodeProcedure = protectedProcedure
  .input(validateCodeSchema)
  .mutation(({ ctx, input: body }) => {
    return serializeRun(
      ctx,
      createRun(ctx, { ...body, operation: "validate" }),
    );
  });
