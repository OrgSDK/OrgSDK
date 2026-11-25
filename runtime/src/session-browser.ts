import { z } from "zod";
import type { Plugin } from "./contract";
import { spawnJob } from "./spawn-job";
import { MAX_VALUE_BYTES } from "./sessions/values";

const reply = z.union([
  z.object({ id: z.uuid(), result: z.json() }),
  z.object({ id: z.uuid(), error: z.string() }),
]);

/** The supervisor creates one owner per live generation and disposes it on every terminal path. */
export class SessionBrowser {
  private readonly process;
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  private stopped = false;

  constructor(options: Parameters<typeof spawnJob>[0], plugin: Plugin) {
    this.process = spawnJob({ ...options, browserSession: true }, "pipe");
    this.process.child.stdin.write(
      JSON.stringify({ plugin, agentId: options.agentId }) + "\n",
    );
    void this.process.child.exited.catch(() => undefined);
    void this.read()
      .catch(() => this.process.kill())
      .finally(() => {
        this.stopped = true;
        for (const waiter of this.pending.values())
          waiter.reject(
            new Error(
              "Session browser worker stopped. Close this execution session and open another.",
            ),
          );
        this.pending.clear();
      });
  }
  private async read() {
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of this.process.child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let end = buffer.indexOf("\n");
      while (end >= 0) {
        const line = buffer.slice(0, end);
        if (Buffer.byteLength(line) > MAX_VALUE_BYTES + 2048)
          throw new Error("Browser result too large");
        const message = reply.parse(JSON.parse(line));
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if ("error" in message) waiter?.reject(new Error(message.error));
        else waiter?.resolve(message.result);
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf("\n");
      }
      if (Buffer.byteLength(buffer) > MAX_VALUE_BYTES + 2048)
        throw new Error("Browser result too large");
    }
  }
  async call(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.stopped) throw new Error("Session browser worker stopped");
    const id = crypto.randomUUID();
    const kill = this.process.kill;
    signal.addEventListener("abort", kill, { once: true });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.process.child.stdin.write(
          JSON.stringify({ id, name, args }) + "\n",
        );
      });
    } finally {
      signal.removeEventListener("abort", kill);
      this.pending.delete(id);
    }
  }
  async close() {
    this.process.child.stdin.end();
    const force = setTimeout(this.process.kill, 2000);
    try {
      await this.process.child.exited;
    } finally {
      clearTimeout(force);
    }
  }
}
