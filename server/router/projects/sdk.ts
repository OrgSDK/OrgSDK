import { scopedProcedure } from "../procedures";
import { projectGrant } from "../../domain/permissions";
import { projectIdSchema } from "../../projects/schemas";
import { projectSnapshot } from "../../projects/snapshot";
export const sdkProcedure = scopedProcedure("catalog:read")
  .input(projectIdSchema)
  .query(({ ctx, input }) => {
    projectGrant(ctx, input.id);
    return projectSnapshot(ctx, input.id).sdk;
  });
