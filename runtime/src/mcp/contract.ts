import { z } from "zod";

const jsonObject = z.record(z.string(), z.json());
export const endpointSchema = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  }, "Use an HTTP(S) URL without embedded credentials or a fragment");
export const transportSchema = z.enum(["auto", "streamable-http", "sse"]);
export const remoteToolSchema = z
  .object({
    name: z.string().min(1).max(256),
    description: z.string().max(10000).optional(),
    inputSchema: jsonObject,
    outputSchema: jsonObject.optional(),
    annotations: jsonObject.optional(),
  })
  .strip();
export const approvedToolSchema = remoteToolSchema.extend({
  alias: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .max(100),
});
export const connectionSchema = z.object({
  id: z.string().uuid(),
  endpoint: endpointSchema,
  transport: transportSchema,
  revision: z.number().int().nonnegative(),
  tools: z.array(approvedToolSchema).max(1000),
});
export const discoverySchema = z.object({
  tools: z.array(remoteToolSchema).max(1000),
  transport: z.enum(["streamable-http", "sse"]),
  authRequired: z.boolean().default(false),
  resourceMetadata: jsonObject.optional(),
});
export const headerSchema = z
  .record(
    z.string().regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/i),
    z
      .string()
      .max(8000)
      .refine((value) => !/[\r\n]/.test(value)),
  )
  .refine(
    (headers) =>
      Object.keys(headers).length <= 20 &&
      Object.keys(headers).every(
        (name) =>
          ![
            "host",
            "connection",
            "content-length",
            "content-type",
            "accept",
            "mcp-session-id",
            "mcp-protocol-version",
          ].includes(name.toLowerCase()),
      ),
    "Unsupported authentication header",
  );
export type RemoteTool = z.infer<typeof remoteToolSchema>;
export type ApprovedTool = z.infer<typeof approvedToolSchema>;
export type McpConnection = z.infer<typeof connectionSchema>;
export type Discovery = z.infer<typeof discoverySchema>;
