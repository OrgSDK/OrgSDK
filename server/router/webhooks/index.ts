import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { createProcedure } from "./create";
import { updateProcedure } from "./update";
import { rotateProcedure } from "./rotate";

export const webhooksRouter = router({
  list: listProcedure,
  get: getProcedure,
  create: createProcedure,
  update: updateProcedure,
  rotate: rotateProcedure,
});
