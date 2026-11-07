import { beginOAuthProcedure } from "./begin-oauth";
import { router } from "../../procedures";
import { createProcedure } from "./create";
import { updateProcedure } from "./update";
import { getProcedure } from "./get";
import { discoverProcedure } from "./discover";
import { acceptProcedure } from "./accept";
export const mcpRouter = router({
  beginOAuth: beginOAuthProcedure,
  create: createProcedure,
  update: updateProcedure,
  get: getProcedure,
  discover: discoverProcedure,
  accept: acceptProcedure,
});
