import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { versionsProcedure } from "./versions";
import { versionProcedure } from "./version";
import { testsProcedure } from "./tests";
import { saveTestsProcedure } from "./save-tests";
import { saveActionProcedure } from "./save-action";
import { createProcedure } from "./create";
import { updateProcedure } from "./update";
import { createVersionProcedure } from "./create-version";
import { validateCodeProcedure } from "./validate-code";
import { runTestsProcedure } from "./run-tests";

export const actionsRouter = router({
  list: listProcedure,
  get: getProcedure,
  versions: versionsProcedure,
  version: versionProcedure,
  tests: testsProcedure,
  saveTests: saveTestsProcedure,
  saveAction: saveActionProcedure,
  create: createProcedure,
  update: updateProcedure,
  createVersion: createVersionProcedure,
  validateCode: validateCodeProcedure,
  runTests: runTestsProcedure,
});
