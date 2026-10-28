import { artifactIdSchema } from "../../runs/artifacts";
import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { artifactsRepository } from "../../repositories/artifacts";
import { artifactView } from "../../runs/artifacts";

export const getProcedure = protectedProcedure
  .input(artifactIdSchema)
  .query(({ ctx, input }) => {
    const id = input.id;

    browser(ctx);
    return artifactView(artifactsRepository(ctx).find(id));
  });
