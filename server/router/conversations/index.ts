import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
export const conversationsRouter = router({
  list: listProcedure,
  get: getProcedure,
});
