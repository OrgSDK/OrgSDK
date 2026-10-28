import { z } from "zod";

const credentialName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !value.includes("\0"));
const credentialSecret = z
  .record(z.string(), z.json())
  .refine(
    (secret) =>
      Object.keys(secret).length > 0 &&
      Buffer.byteLength(JSON.stringify(secret)) <= 32_000,
    "Supply a nonempty secret object under 32KB.",
  );

export const credentialSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  provider: z.string(),
});

export const credentialCreateSchema = z.strictObject({
  name: credentialName,
  provider: credentialName,
  secret: credentialSecret,
});

export const updateCredentialSchema = credentialCreateSchema.partial();
export const credentialIdSchema = z.strictObject({ id: z.uuid() });
export const credentialChangesSchema = updateCredentialSchema.extend({
  id: z.uuid(),
});
