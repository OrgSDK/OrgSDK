import type { workspaceTables, tableRows } from "../db/schema";
export function standard(row: typeof workspaceTables.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    columns: row.columns,
    revision: row.revision,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function rowView(row: typeof tableRows.$inferSelect) {
  return {
    id: row.id,
    values: row.values,
    revision: row.revision,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
