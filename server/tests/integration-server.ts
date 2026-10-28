import { resolve } from "node:path";
import type { AppDependencies } from "../application";
import { createApp } from "../app";

export async function integrationServer(
  dependencies: AppDependencies,
  directory: string,
) {
  const binary = process.env.ORGSDK_TEST_BINARY;
  if (!binary) {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: createApp(dependencies),
    });
    return {
      origin: `http://127.0.0.1:${server.port}`,
      close: () => server.stop(true),
    };
  }
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = reservation.port!;
  await reservation.stop(true);
  const child = Bun.spawn([resolve(binary)], {
    cwd: directory,
    env: {
      ...process.env,
      ORGSDK_DATA_DIR: resolve(directory, "data"),
      HOST: "127.0.0.1",
      PORT: String(port),
      PATH: "/nonexistent",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  const origin = `http://127.0.0.1:${port}`;
  async function close() {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      await child.exited;
    } finally {
      clearTimeout(timeout);
    }
  }
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) {
        throw new Error(
          `Compiled server failed: ${await new Response(child.stderr).text()}`,
        );
      }
      try {
        const response = await fetch(`${origin}/trpc/system.health`);
        if (response.ok) {
          return { origin, close };
        }
      } catch {
        /* The owned child has not bound its listener yet. */
      }
      await Bun.sleep(20);
    }
    throw new Error("Compiled server did not become healthy.");
  } catch (error) {
    await close();
    throw error;
  }
}
