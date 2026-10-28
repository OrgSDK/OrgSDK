import { z } from "zod";
const identifier = z.uuid();
const documentFields = {
  kind: z.enum(["memory", "document"]),
  title: z.string(),
  content: z
    .string()
    .max(200000)
    .refine((value) => !value.includes("\0"), "Invalid document."),
};
export const documentIdSchema = z.strictObject({ id: identifier });
export const createDocumentSchema = z.strictObject(documentFields);
export const updateDocumentSchema = z.strictObject({
  id: identifier,
  ...z.object(documentFields).partial().shape,
});
