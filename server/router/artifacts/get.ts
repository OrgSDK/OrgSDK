import { artifactIdSchema } from "../../runs/artifacts";
import { browserWorkspaceProcedure } from "../procedures";
import { artifactsRepository } from "../../repositories/artifacts";
import { artifactView } from "../../runs/artifacts";

export const getProcedure = browserWorkspaceProcedure
  .input(artifactIdSchema)
  .query(({ ctx, input }) => {
    const id = input.id;
    return artifactView(artifactsRepository(ctx).find(id));
  });
