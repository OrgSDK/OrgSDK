import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

export async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

export function command(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: unknown) => {
      if (typeof chunk === "string") {
        output = (output + chunk).slice(-32_000);
      }
    });
  }
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return {
    child,
    exited,
    output: () => output,
    async success() {
      assert.equal(await exited, 0, output);
      return output;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
      try {
        const status = await exited;
        assert(
          status === 0 || status === 143,
          `Ungraceful shutdown (${status}):\n${output}`,
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export async function startInstallation(
  cli: string,
  directory: string,
  port: number,
  nodePath: string,
) {
  const origin = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    PATH: nodePath,
    HOME: directory,
    ORGSDK_DATA_DIR: join(directory, "data"),
    HOST: "127.0.0.1",
    PORT: String(port),
    PLUGIN_MARKETPLACE_URL: "",
  };
  const process = command(
    globalThis.process.execPath,
    [cli, "start"],
    directory,
    env,
  );
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      assert.equal(process.child.exitCode, null, process.output());
      try {
        const health = await fetch(`${origin}/trpc/system.health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (health.ok) {
          return { ...process, env, origin };
        }
      } catch {
        // The supervised server has not bound its listener yet.
      }
      await sleep(100);
    }
    throw new Error(`Installation did not become ready:\n${process.output()}`);
  } catch (error) {
    await process.stop();
    throw error;
  }
}

export function api(origin: string) {
  const cookies = new Map<string, string>();
  return async (
    procedure: string,
    input?: unknown,
    mutation = false,
  ): Promise<unknown> => {
    const query =
      !mutation && input !== undefined
        ? `?input=${encodeURIComponent(JSON.stringify(input))}`
        : "";
    const response = await fetch(`${origin}/trpc/${procedure}${query}`, {
      method: mutation ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        Cookie: [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        "X-CSRFToken": cookies.get("csrftoken") ?? "",
      },
      ...(mutation ? { body: JSON.stringify(input) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      assert(pair);
      const separator = pair.indexOf("=");
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const payload: unknown = await response.json();
    assert(response.ok, `${procedure}: ${JSON.stringify(payload)}`);
    return z.object({ result: z.object({ data: z.unknown() }) }).parse(payload)
      .result.data;
  };
}

export const runSchema = z.object({
  id: z.string(),
  status: z.string(),
  output: z.unknown().optional(),
  error: z.unknown().optional(),
});

export async function waitForRun(
  rpc: ReturnType<typeof api>,
  id: string,
  expected = "succeeded",
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const run = runSchema.parse(await rpc("runs.get", { id }));
    if (
      ["succeeded", "failed", "cancelled", "timed_out"].includes(run.status)
    ) {
      assert.equal(run.status, expected, JSON.stringify(run));
      return run;
    }
    await sleep(250);
  }
  throw new Error(`Run ${id} did not finish.`);
}
