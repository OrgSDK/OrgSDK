import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { Client } from "./client";
const decision = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), id: z.uuid() }),
  z.object({ status: z.enum(["approved", "denied", "interrupted"]) }),
]);
export function shellPolicy(
  client: Client,
  pluginId: string,
  onApprovalWait?: () => void,
) {
  return {
    listAllowed: async () =>
      z.array(z.string()).parse(await client.shellRules(pluginId)),
    async authorize(executable: string, args: string[]) {
      let result = decision.parse(
        await client.requestShellApproval(pluginId, executable, args),
      );
      while (result.status === "pending") {
        onApprovalWait?.();
        await sleep(500, undefined, { signal: client.signal });
        result = decision.parse(
          await client.shellApproval(pluginId, result.id),
        );
      }
      client.signal?.throwIfAborted();
      if (result.status !== "approved") {
        throw new Error("Shell execution blocked or interrupted.");
      }
    },
  };
}
