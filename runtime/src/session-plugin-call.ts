import { z } from "zod";
import type { Client } from "./client";
import { loadPlugin } from "./plugins";
import { mcpPlugin } from "./mcp/functions";
import { pluginSchema } from "./contract";
import { jsonValue } from "./sessions/values";

export const pluginCallSchema = z.object({
  type: z.literal("session_plugin_call"),
  agentId: z.uuid(),
  capability: z.string(),
  plugin: pluginSchema,
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  args: z.object({}).catchall(z.json()),
});

export async function executePluginCall(
  request: z.infer<typeof pluginCallSchema>,
  client: Client,
): Promise<void> {
  const { plugin, agentId, name, args } = request;
  const remote =
    plugin.distribution === "mcp"
      ? mcpPlugin(plugin, client, client.signal ?? new AbortController().signal)
      : undefined;
  try {
    const functions =
      remote?.functions ?? (await loadPlugin(plugin, client, agentId));
    const fn = functions.find((entry) => entry.name === name);
    if (!fn || fn.calling !== "named") {
      throw new Error("Plugin function is unavailable");
    }
    const result = jsonValue(await fn.handler(args));
    process.stdout.write(JSON.stringify({ result }) + "\n");
  } finally {
    await remote?.runtime.close();
  }
}
