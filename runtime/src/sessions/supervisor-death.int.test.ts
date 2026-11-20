import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(new URL("./process.ts", import.meta.url));

async function stopsAfterSupervisorDeath(mode: "host" | "docker") {
  const directory = await mkdtemp(`${tmpdir()}/orgsdk-session-orphan-`);
  const id = crypto.randomUUID();
  const container = `orgsdk-session-${id}-1`;
  const options = {
    id,
    generation: 1,
    mode,
    workspaceDirectory: directory,
    image: process.env.EXECUTOR_IMAGE ?? "orgsdk-job:dev",
    sourceDirectory: mode === "docker" ? dirname(dirname(modulePath)) : undefined,
  };
  const supervisor = Bun.spawn(
    [
      process.execPath, "--no-env-file", "--eval",
      `import { SessionProcess } from ${JSON.stringify(modulePath)};
       const session = new SessionProcess(${JSON.stringify(options)}, {
         event() { console.log(JSON.stringify(identity)); },
         call() { throw new Error("Unexpected capability request"); },
         exit() {},
       });
       const identity = await session.initialize([]);
       await session.execute(crypto.randomUUID(), ${JSON.stringify(`
         await Promise.resolve();
         console.log("started");
         const finishAt = Date.now() + 14_000;
         while (Date.now() < finishAt) Math.sqrt(42);
         return "done";
       `)}, {});`,
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  try {
    const stream = supervisor.stdout.getReader();
    const ready = await stream.read();
    stream.releaseLock();
    const identity = JSON.parse(new TextDecoder().decode(ready.value)) as { pid: number };
    const hasStopped = async () => {
      if (mode === "docker") {
        const query = Bun.spawn(["docker", "inspect", container], { stdout: "ignore", stderr: "ignore" });
        return await query.exited !== 0;
      }
      try {
        // A zombie is no longer running. The test container's init may reap the PID later.
        const status = await readFile(`/proc/${identity.pid}/status`, "utf8");
        return /^State:\s+Z/m.test(status);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        throw error;
      }
    };
    expect(await hasStopped()).toBe(false);
    supervisor.kill("SIGKILL");
    await supervisor.exited;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await hasStopped()) return;
      await Bun.sleep(100);
    }
    throw new Error(`${mode} worker kept running after supervisor death`);
  } finally {
    supervisor.kill();
    await supervisor.exited;
    if (mode === "docker") {
      await Bun.spawn(["docker", "rm", "-f", container], { stdout: "ignore", stderr: "ignore" }).exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test("host worker stops during a bounded CPU cell when the supervisor dies", () =>
  stopsAfterSupervisorDeath("host"), 20_000);

test.skipIf(process.env.ORGSDK_SESSION_DOCKER_TEST !== "1")(
  "Docker worker stops during a bounded CPU cell when the supervisor dies",
  () => stopsAfterSupervisorDeath("docker"),
  25_000,
);
