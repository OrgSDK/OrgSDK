import { createRun } from "../../runs/create";
import { createRunSchema } from "../../runs/schemas";
import { serializeRun } from "../../runs/views";
import { protectedProcedure } from "../procedures";
export const createProcedure = protectedProcedure
  .input(createRunSchema)
  .mutation(({ ctx, input }) => serializeRun(ctx, createRun(ctx, input)));
