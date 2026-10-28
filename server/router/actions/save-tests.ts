import { saveTestsSchema } from "../../actions/schemas";
import { actionTestSuites } from "../../db/schema";
import { scopedProcedure } from "../procedures";
import { projectGrant, tx } from "../../domain/permissions";
import { recordAudit } from "../../repositories/audit";
import { base } from "../../shared/records";
import { validateCases } from "../../shared/contracts";
import { digest } from "../../shared/security";
import { actionsRepository } from "../../repositories/actions";
import { suiteView } from "../../actions/views";
import { findTestSuite, requireVersion } from "../../actions/version-queries";

export const saveTestsProcedure = scopedProcedure("actions:write")
  .input(saveTestsSchema)
  .mutation(({ ctx, input }) => {
    return tx(ctx, (ctx) => {
      const action = actionsRepository(ctx).find(input.id);
      projectGrant(ctx, action.projectId);
      const version = requireVersion(ctx, action.id, input.version);
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
