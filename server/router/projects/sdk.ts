import { protectedProcedure } from "../procedures";
import { scope, projectGrant } from "../../domain/permissions";
import { projectIdSchema } from "../../projects/schemas";
import { projectSnapshot } from "../../projects/snapshot";
export const sdkProcedure = protectedProcedure
  .input(projectIdSchema)
  .query(({ ctx, input }) => {
    scope(ctx, "catalog:read");
    projectGrant(ctx, input.id);
    return projectSnapshot(ctx, input.id).sdk;
  });
