import { beginOAuthProcedure } from "./begin-oauth";
import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { createProcedure } from "./create";
import { updateProcedure } from "./update";
import { deleteProcedure } from "./delete";
export const credentialsRouter = router({
  beginOAuth: beginOAuthProcedure,
  list: listProcedure,
  get: getProcedure,
  create: createProcedure,
  update: updateProcedure,
  delete: deleteProcedure,
});
