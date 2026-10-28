import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { createProcedure } from "./create";
import { updateProcedure } from "./update";
import { deleteProcedure } from "./delete";
import { catalogProcedure } from "./catalog";
import { marketplaceProcedure } from "./marketplace";
export const pluginsRouter = router({
  list: listProcedure,
  get: getProcedure,
  create: createProcedure,
  update: updateProcedure,
  delete: deleteProcedure,
  catalog: catalogProcedure,
  marketplace: marketplaceProcedure,
});
