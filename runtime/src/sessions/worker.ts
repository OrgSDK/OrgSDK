import { hostname } from "node:os";
import { createInterface } from "node:readline";
import { z } from "zod";
import { SessionKernel } from "./kernel";
import { errorText, jsonValue } from "./values";

const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("initialize"),
    requestId: z.string(),
    functions: z.array(z.string()),
  }),
  z.object({
    type: z.literal("execute"),
    requestId: z.string(),
    cellId: z.string(),
    source: z.string(),
    inputs: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("toolResult"),
    callId: z.string(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
]);
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const send = (message: unknown) => {
  process.stdout.write(JSON.stringify(message) + "\n");
};
let kernel: SessionKernel | undefined;

for await (const line of createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})) {
  try {
    if (Buffer.byteLength(line) > 1_000_000)
      throw new Error("Session command exceeds limit");
    const data = command.parse(JSON.parse(line));
    if (data.type === "toolResult") {
      const call = pending.get(data.callId);
      pending.delete(data.callId);
      if (data.error) call?.reject(new Error(data.error));
      else call?.resolve(data.value);
      continue;
    }
    if (data.type === "initialize") {
      if (kernel) throw new Error("Session already initialized");
      kernel = new SessionKernel(data.functions, {
        emit: (cellId, kind, value) =>
          send({ type: "event", cellId, kind, data: value }),
        call: (cellId, name, args) =>
          new Promise((resolve, reject) => {
            const callId = crypto.randomUUID();
            pending.set(callId, { resolve, reject });
            send({ type: "call", callId, cellId, name, args });
          }),
      });
      send({
        type: "result",
        requestId: data.requestId,
        value: { pid: process.pid, hostname: hostname() },
      });
      continue;
    }
    if (!kernel) throw new Error("Session is not initialized");
    // Keep reading tool replies while an async cell is evaluating.
    void kernel.execute(data.cellId, data.source, data.inputs).then(
      (value) =>
        send({
          type: "result",
          requestId: data.requestId,
          value: jsonValue(value),
        }),
      (error) =>
        send({
          type: "result",
          requestId: data.requestId,
          error: errorText(error),
        }),
    );
  } catch {
    process.exit(1);
  }
}
process.exit(0);
