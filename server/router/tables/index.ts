import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { createProcedure } from "./create";
import { updateProcedure } from "./update";
import { deleteProcedure } from "./delete";
import { listRowsProcedure } from "./list-rows";
import { getRowProcedure } from "./get-row";
import { createRowProcedure } from "./create-row";
import { updateRowProcedure } from "./update-row";
import { deleteRowProcedure } from "./delete-row";

export const tablesRouter = router({
  list: listProcedure,
  get: getProcedure,
  create: createProcedure,
  update: updateProcedure,
  delete: deleteProcedure,
  listRows: listRowsProcedure,
  getRow: getRowProcedure,
  createRow: createRowProcedure,
  updateRow: updateRowProcedure,
  deleteRow: deleteRowProcedure,
});
