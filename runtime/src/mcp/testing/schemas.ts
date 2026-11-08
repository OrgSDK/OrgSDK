import { z } from "zod";

/** JSON-RPC request envelope shared by the MCP test fixtures. */
export const jsonRpcRequestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
