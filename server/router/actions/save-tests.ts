import { saveTestsSchema } from "../../actions/schemas";
import { protectedProcedure } from "../procedures";
import { authoringGrant, scope, tx } from "../../domain/permissions";
import { actionTestSuitesRepository } from "../../repositories/action-test-suites";
import { actionsRepository } from "../../repositories/actions";
import { validateCases } from "../../shared/contracts";
import { digest } from "../../shared/security";
import { actionVersion } from "../../actions/versions";
import { suiteView } from "../../actions/views";
import { findTestSuite } from "../../actions/version-queries";

export const saveTestsProcedure = protectedProcedure
  .input(saveTestsSchema)
  .mutation(({ ctx, input }) => {
    scope(ctx, "actions:write");
    return tx(ctx, (ctx) => {
      const action = actionsRepository(ctx).find(input.id);
      authoringGrant(ctx, action.projectId);
      const version = actionVersion(ctx, input.id, input.version).version;
      const cases = validateCases(version, input.cases);
      const hash = digest(JSON.stringify(cases));
      const latest = findTestSuite(ctx, version.id);
      if (latest?.digest === hash) {
        return suiteView(latest);
      }
      return suiteView(
        actionTestSuitesRepository(ctx).create({
          versionId: version.id,
          number: (latest?.number ?? 0) + 1,
          cases,
          digest: hash,
        }),
      );
    });
  });
