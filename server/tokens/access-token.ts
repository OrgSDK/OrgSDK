import { z } from "zod";
import { digest, randomSecret } from "../shared/security";

export const mcpTokenPrefix = "orgsdk_mcp_";
export const mcpAccessTokenSchema = z.templateLiteral([
  mcpTokenPrefix,
  z.string().regex(/[A-Za-z0-9_-]{43}/),
]);
export const issuedMcpAccessTokenSchema = z.object({
  id: z.uuid(),
  token: mcpAccessTokenSchema,
});
export type McpAccessToken = z.infer<typeof mcpAccessTokenSchema>;

export function issueMcpAccessToken(): McpAccessToken {
  return `${mcpTokenPrefix}${randomSecret()}`;
}

export function mcpAccessTokenDigest(token: McpAccessToken): string {
  // Hash the secret portion so existing token records keep their grants and history.
  return digest(token.slice(mcpTokenPrefix.length));
}
