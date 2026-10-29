import { z } from "zod";
const identifier = z.uuid();
const revision = z.number().int().positive();
const columns = z.array(
  z.strictObject({
    key: z.string(),
    type: z.enum(["text", "number", "boolean", "date"]),
    required: z.boolean(),
  }),
);
const values = z.record(z.string(), z.json());
export const tableIdSchema = z.strictObject({ id: identifier });
export const createTableSchema = z.strictObject({ name: z.string(), columns });
export const updateTableSchema = z.strictObject({
  id: identifier,
  revision,
  name: z.string().optional(),
  columns: columns.optional(),
});
export const deleteTableSchema = z.strictObject({ id: identifier, revision });
export const tableRowSchema = z.strictObject({
  id: identifier,
  rowId: identifier,
});
export const createRowSchema = z.strictObject({
  id: identifier,
  table_revision: revision,
  values,
});
export const updateRowSchema = z.strictObject({
  id: identifier,
  rowId: identifier,
  table_revision: revision,
  revision,
  values,
});
export const deleteRowSchema = z.strictObject({
  id: identifier,
  rowId: identifier,
  revision,
});
