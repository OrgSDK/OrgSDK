import type { ServiceContext } from "../application";
import { tableRowsRepository } from "../repositories/table-rows";
import { ServiceError } from "../shared/errors";
export function rowInTable(
  ctx: ServiceContext,
  tableId: string,
  rowId: string,
) {
  const row = tableRowsRepository(ctx).find(rowId);
  if (row.tableId !== tableId) {
    throw new ServiceError("NOT_FOUND", "Not found.");
  }
  return row;
}
