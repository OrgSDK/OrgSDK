import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "./index";

test.skipIf(process.env.ORGSDK_SESSION_DOCKER_TEST !== "1")(
  "Docker session reuses its actual container across cells and retains history after a forced stop",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "orgsdk-session-docker-"));
    const scope = {
      workspaceId: "docker-test",
      projectId: "project",
      ownerId: "client",
    };
    const manager = new SessionManager({
      historyDirectory: join(directory, "history"),
      image: process.env.EXECUTOR_IMAGE ?? "orgsdk-job:dev",
      sourceDirectory:
        process.env.ORGSDK_SESSION_PACKAGED_TEST === "1"
          ? undefined
          : join(import.meta.dir, ".."),
      cellTimeoutMs: 10_000,
    });
    try {
      const session = await manager.open({
        ...scope,
        workspaceDirectory: join(directory, "workspace"),
        configurationRevision: "fixture",
      });
      const name = `orgsdk-session-${session.id}-1`;
      const inspect = async () => {
        const child = Bun.spawn(
          ["docker", "inspect", "--format={{.Id}}", name],
          { stdout: "pipe", stderr: "pipe" },
        );
        const text = await new Response(child.stdout).text();
        expect(await child.exited).toBe(0);
        return text.trim();
      };
      const identity = await inspect();
      const run = (
        source: string,
        expectedSequence: number,
        timeoutMs?: number,
      ) =>
        manager.execute(session.id, scope, {
          id: crypto.randomUUID(),
          generation: 1,
          expectedSequence,
          source,
          timeoutMs,
        });
      expect(
        (
          await run(
            "const response = await Promise.resolve({value: 41}); await writeFile('kept.txt', 'retained'); return response.value;",
            0,
          )
        ).cell.result,
      ).toBe(41);
      expect(
        (
          await run(
            "let value = response.value; function read() { return value; } value++; return read();",
            1,
          )
        ).cell.result,
      ).toBe(42);
      expect(
        (
          await run(
            "console.log('same container'); return {value: read(), file: await readFile('kept.txt')};",
            2,
          )
        ).cell.result,
      ).toEqual({ value: 42, file: "retained" });
      expect(await inspect()).toBe(identity);
      expect((await manager.inspect(session.id, scope)).worker).toEqual(
        session.worker,
      );
      const stopped = await run(
        "await Promise.resolve(); console.log('before forced stop'); while (true) {}",
        3,
        2000,
      );
      expect(stopped.cell.status).toBe("interrupted");
      const history = await manager.inspect(session.id, scope);
      expect(history.status).toBe("expired");
      expect(history.cells).toHaveLength(4);
      expect(
        history.events.some((event) => event.kind === "execution.log"),
      ).toBe(true);
      const removed = Bun.spawnSync(["docker", "inspect", name], {
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(removed.exitCode).not.toBe(0);
    } finally {
      await manager.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
  45_000,
);
