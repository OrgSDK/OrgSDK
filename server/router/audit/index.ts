import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";

export const auditRouter = router({
  list: listProcedure,
  get: getProcedure,
});
