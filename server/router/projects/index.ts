import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { createProcedure } from "./create";
import { updateProcedure } from "./update";
import { deleteProcedure } from "./delete";
import { sdkProcedure } from "./sdk";
import { connectExecutorProcedure } from "./connect-executor";
import { disconnectExecutorProcedure } from "./disconnect-executor";
export const projectsRouter = router({
  list: listProcedure,
  get: getProcedure,
  create: createProcedure,
  update: updateProcedure,
  delete: deleteProcedure,
  sdk: sdkProcedure,
  connectExecutor: connectExecutorProcedure,
  disconnectExecutor: disconnectExecutorProcedure,
});
