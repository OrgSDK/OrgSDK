import { z } from "zod";

export const mcpArgumentsSchema = z
  .object({
    action: z.string().optional(),
    project: z.string().optional(),
    id: z.string().optional(),
    version: z.number().optional(),
    suite_revision: z.number().optional(),
    after: z.number().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  })
  .catchall(z.json());
