import { saveTestsSchema } from "../../actions/schemas";
import { actionTestSuites } from "../../db/schema";
import { scopedProcedure } from "../procedures";
import { authoringGrant, tx } from "../../domain/permissions";
import { recordAudit } from "../../repositories/audit";
import { base } from "../../shared/records";
import { actionsRepository } from "../../repositories/actions";
import { validateCases } from "../../shared/contracts";
import { digest } from "../../shared/security";
import { actionVersion } from "../../actions/versions";
import { suiteView } from "../../actions/views";
import { findTestSuite } from "../../actions/version-queries";

export const saveTestsProcedure = scopedProcedure("actions:write")
  .input(saveTestsSchema)
  .mutation(({ ctx, input }) => {
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
      const suite = ctx.db
        .insert(actionTestSuites)
        .values({
          ...base(ctx.workspace.id),
          versionId: version.id,
          number: (latest?.number ?? 0) + 1,
          cases,
          digest: hash,
        })
        .returning()
        .get();
      recordAudit(ctx, "action.tests", suite.id, "created");
      return suiteView(suite);
    });
  });
