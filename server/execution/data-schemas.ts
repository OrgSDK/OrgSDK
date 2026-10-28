import { z } from "zod";

const pagination = {
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(100),
};
const tableId = { table_id: z.string().uuid() };
const revision = z.number().int().positive();
const content = z
  .string()
  .refine(
    (value) => !value.includes("\0") && Buffer.byteLength(value) <= 200_000,
  );
export const dataOperationSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("list_tables"), ...pagination }),
  z.strictObject({ operation: z.literal("get_table"), ...tableId }),
  z.strictObject({
    operation: z.literal("list_rows"),
    ...tableId,
    ...pagination,
  }),
  z
    .strictObject({
      operation: z.literal("write_row"),
      ...tableId,
      table_revision: revision,
      values: z.record(z.string(), z.json()),
      row_id: z.string().uuid().optional(),
      revision: revision.optional(),
    })
    .refine(
      (input) =>
        (input.row_id === undefined) === (input.revision === undefined),
      "Row updates require both row ID and revision.",
    ),
  z.strictObject({
    operation: z.literal("delete_row"),
    ...tableId,
    row_id: z.string().uuid(),
    revision,
  }),
  z.strictObject({ operation: z.literal("list_documents"), ...pagination }),
  z.strictObject({
    operation: z.literal("get_document"),
    document_id: z.string().uuid(),
  }),
  z.strictObject({
    operation: z.literal("write_document"),
    document_id: z.string().uuid(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !value.includes("\0"))
      .optional(),
    content: content.optional(),
  }),
]);
export type DataOperation = z.output<typeof dataOperationSchema>;
