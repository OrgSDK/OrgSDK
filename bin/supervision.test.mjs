import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { supervise } from "./supervision.mjs";

async function readEventually(filename) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await readFile(filename, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await delay(50);
    }
  }
  throw new Error(`Timed out waiting for ${filename}`);
}

async function fixture() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), "orgsdk-supervision-"));
  const server = join(directory, "server.mjs");
  const executor = join(directory, "executor.mjs");
  const wrapper = join(directory, "wrapper.mjs");
  await writeFile(
    server,
    `
    import { createServer } from 'node:http';
    import { writeFileSync } from 'node:fs';
    const server = createServer((request,response) => response.end(JSON.stringify({result:{data:{status:'ok'}}})));
    server.listen(${port}, '127.0.0.1', () => writeFileSync(${JSON.stringify(join(directory, "server.json"))}, JSON.stringify({pid:process.pid,port:server.address().port})));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `,
  );
  await writeFile(
    executor,
    `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    const worker = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    writeFileSync(${JSON.stringify(join(directory, "executor.json"))}, JSON.stringify({pid:process.pid,worker:worker.pid}));
    process.on('SIGTERM', () => process.exit(0));
    setInterval(()=>{},1000);
  `,
  );
  await writeFile(
    wrapper,
    `
    import { supervise } from ${JSON.stringify(new URL("./supervision.mjs", import.meta.url).href)};
    const server=${JSON.stringify(server)},executor=${JSON.stringify(executor)};
    process.exitCode=await supervise({server,executor,env:process.env,address:'http://127.0.0.1:${port}'});
  `,
  );
  const child = spawn(process.execPath, [wrapper], {
    stdio: "pipe",
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  return { directory, child, closed };
}

test(
  "SIGTERM shuts down the platform, manager and surviving worker descendants",
  { timeout: 15_000 },
  async () => {
    const current = await fixture();
    try {
      const executor = JSON.parse(
        await readEventually(join(current.directory, "executor.json")),
      );
      const server = JSON.parse(
        await readEventually(join(current.directory, "server.json")),
      );
      current.child.kill("SIGTERM");
      assert.equal(await current.closed, 143);
      for (const pid of [server.pid, executor.pid, executor.worker]) {
        let alive = true;
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            process.kill(pid, 0);
          } catch (error) {
            assert.equal(error.code, "ESRCH");
            alive = false;
            break;
          }
          await delay(50);
        }
        // A killed orphan may remain a zombie until init reaps it in containers.
        if (alive) {
          assert.match(await readFile(`/proc/${pid}/stat`, "utf8"), /\) Z /);
        }
      }
    } finally {
      current.child.kill("SIGTERM");
      await Promise.race([current.closed, delay(1000)]);
      current.child.kill("SIGKILL");
      await rm(current.directory, { recursive: true, force: true });
    }
  },
);

test(
  "a failed platform exits with its status and never starts the manager",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "orgsdk-startup-failure-"));
    try {
      const server = join(directory, "server.mjs");
      const executor = join(directory, "executor.mjs");
      const marker = join(directory, "executor-started");
      await writeFile(server, "process.exit(7);");
      await writeFile(
        executor,
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started');`,
      );
      const status = await supervise({
        server,
        executor,
        env: process.env,
        address: "http://127.0.0.1:1",
      });
      assert.equal(status, 7);
      await assert.rejects(readFile(marker), { code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
