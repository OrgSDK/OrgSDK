import { actionTestsSchema } from "../../actions/schemas";
import { scopedProcedure } from "../procedures";
import { authorizeVersion } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { actionVersion } from "../../actions/versions";
import { suiteView } from "../../actions/views";
import { findTestSuite } from "../../actions/version-queries";

export const testsProcedure = scopedProcedure("catalog:read")
  .input(actionTestsSchema)
  .query(({ ctx, input }) => {
    const { action, version } = actionVersion(ctx, input.id, input.version);
    authorizeVersion(ctx, action, version, true);
    const selected = findTestSuite(ctx, version.id, input.suite_revision);
    if (!selected) {
      throw new ServiceError(
        "NOT_FOUND",
        "No test suite saved for this version.",
      );
    }
    return suiteView(selected);
  });
