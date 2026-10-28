import { promoteRunSchema } from "../../runs/schemas";
import { protectedProcedure } from "../procedures";
import { resolveActionForSave, versionForSave } from "../../actions/versions";
import { serializeVersion } from "../../actions/views";
import {
  authoringGrant,
  authorizeRunRead,
  scope,
  tx,
} from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { runsRepository } from "../../repositories/runs";
import { jsonValue, sourceText } from "../../shared/contracts";

export const promoteProcedure = protectedProcedure
  .input(promoteRunSchema)
  .mutation(({ ctx, input }) =>
    tx(ctx, (ctx) => {
      const run = runsRepository(ctx).find(input.id);
      authorizeRunRead(ctx, run);
      scope(ctx, "actions:write");
      authoringGrant(ctx, run.projectId);
      if (run.operation !== "code") {
        throw new ServiceError(
          "BAD_REQUEST",
          "Only one-off code runs can be promoted.",
        );
      }
      const action = resolveActionForSave(
        ctx,
        run.projectId,
        input.name,
        input.action,
      );
      return {
        action: action.id,
        version: serializeVersion(
          versionForSave(
            ctx,
            action,
            {
              ...input,
              source: sourceText(run.snapshot.source),
              sdk_contract: jsonValue(
                {
                  sdk_revision: run.snapshot.sdk_revision,
                  configuration_revision: run.snapshot.configuration_revision,
                  sdk: run.snapshot.sdk,
                },
                "SDK contract",
              ),
            },
            run.id,
          ),
        ),
      };
    }),
  );
