import { z } from "zod";
import { strongPassword, validEmail } from "./validation";
export const emailSchema = z
  .string()
  .refine(validEmail, "Enter a valid email address.");
export const passwordSchema = z
  .string()
  .refine(strongPassword, "Choose a stronger password.");
export const loginSchema = z.strictObject({
  email: z.string(),
  password: z.string().max(1024),
});
export const codeSchema = z.strictObject({ code: z.string() });
export const signupSchema = z.strictObject({
  email: emailSchema,
  username: z.string().trim().min(1).max(150),
  password: passwordSchema,
});
export const setupSchema = z
  .strictObject({
    domain: z.string(),
    workspace_name: z.string().trim().min(1),
    username: z.string().trim().min(1),
    email: emailSchema,
    password1: passwordSchema,
    password2: z.string(),
    project_name: z.string().optional(),
  })
  .refine((body) => body.password1 === body.password2, "Passwords must match.");
export const passwordChangeSchema = z.strictObject({
  current_password: z.string().max(1024),
  new_password: passwordSchema,
});
export const emailChangeSchema = z.strictObject({ email: emailSchema });
export const reauthenticationSchema = z.strictObject({
  password: z.string().max(1024),
});
export const profileSchema = z.strictObject({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});
