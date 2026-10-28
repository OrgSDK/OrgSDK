export function standard(row: any) {
  return {
    id: row.id,
    name: row.name,
    columns: row.columns,
    revision: row.revision,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function rowView(row: any) {
  return {
    id: row.id,
    values: row.values,
    revision: row.revision,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
