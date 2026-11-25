import { createInterface } from "node:readline";
import { z } from "zod";
import { Client } from "./client";
import { pluginSchema } from "./contract";
import { loadPlugin } from "./plugins";
import { jsonValue } from "./sessions/values";

const lines = createInterface({ input: process.stdin });
const messages = lines[Symbol.asyncIterator]();
const init = await messages.next();
const { plugin, agentId } = z
  .object({
    plugin: pluginSchema.extend({
      slug: z.literal("playwright-local"),
      distribution: z.literal("external"),
      credential_id: z.null(),
    }),
    agentId: z.uuid(),
  })
  .parse(JSON.parse(z.string().parse(init.value)));
// This credential-free instance receives no run or registration token.
const functions = await loadPlugin(
  plugin,
  new Client(process.env.ORGSDK_SERVER_URL!, ""),
  agentId,
);
const calls = new Map(functions.map((fn) => [fn.name, fn]));
const request = z.object({
  id: z.uuid(),
  name: z.string(),
  args: z.record(z.string(), z.json()),
});
try {
  for await (const line of messages) {
    const { id, name, args } = request.parse(JSON.parse(line));
    try {
      const fn = calls.get(name);
      if (!fn || fn.calling !== "named")
        throw new Error("Browser function unavailable");
      const result = jsonValue(await fn.handler(args));
      process.stdout.write(JSON.stringify({ id, result }) + "\n");
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          id,
          error:
            error instanceof Error
              ? error.message.slice(0, 1024)
              : "Browser call failed",
        }) + "\n",
      );
    }
  }
} finally {
  await calls.get("closePage")?.handler({});
}
