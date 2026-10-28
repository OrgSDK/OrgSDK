import { createActionSchema } from "../../actions/schemas";
import { protectedProcedure } from "../procedures";
import { tx } from "../../domain/permissions";
import { actionsRepository } from "../../repositories/actions";
import {
  booleanValue,
  optionalDescription,
  text,
} from "../../shared/validation";
import { serializeAction } from "../../actions/views";
import { authoringProject } from "../../actions/authoring";

export const createProcedure = protectedProcedure
  .input(createActionSchema)
  .mutation(({ ctx, input: body }) => {
    return tx(ctx, (ctx) => {
      const projectId = authoringProject(ctx, body);
      return serializeAction(
        actionsRepository(ctx).create({
          projectId,
          name: text(body.name, "name"),
          description: optionalDescription(body.description),
          enabled: booleanValue(body.enabled, true),
        }),
      );
    });
  });
