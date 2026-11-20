import { z } from "zod";
import type { Client } from "../client";
import type { Plugin } from "../contract";
import type { SandboxFunction } from "../engine/sandbox/types";
import { McpRuntime } from "./client";
import { connectionSchema, headerSchema } from "./contract";

const executionSecretSchema = z.object({
  headers: z.unknown(),
  expires_at: z.number().optional(),
});

export function mcpPlugin(plugin: Plugin, client: Client, signal: AbortSignal) {
  const connection = connectionSchema.parse(plugin.mcp);
  let cached:
    { headers: Record<string, string>; expiresAt: number } | undefined;
  const runtime = new McpRuntime(
    connection,
    async () => {
      if (!plugin.credential_id) return {};
      if (cached && cached.expiresAt > Date.now() + 60_000)
        return cached.headers;
      const secret = executionSecretSchema.parse(
        await client.secret(plugin.credential_id),
      );
      cached = {
        headers: headerSchema.parse(secret.headers),
        expiresAt: secret.expires_at ?? Number.POSITIVE_INFINITY,
      };
      return cached.headers;
    },
    signal,
  );
  const functions: SandboxFunction[] = connection.tools.map((tool) => ({
    name: tool.alias,
    category: plugin.slug,
    calling: "named",
    description: tool.description ?? "",
    handler: (args: unknown) => runtime.call(tool.alias, args),
  }));
  return { runtime, functions };
}
