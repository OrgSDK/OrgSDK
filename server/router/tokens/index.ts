import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { createProcedure } from "./create";
import { revokeProcedure } from "./revoke";

export const tokensRouter = router({
  list: listProcedure,
  get: getProcedure,
  create: createProcedure,
  revoke: revokeProcedure,
});
