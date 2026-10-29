import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export async function verifyManagerShutdown(packageDirectory, runtimeLabel) {
  const directory = await mkdtemp(join(tmpdir(), "orgsdk-manager-shutdown-"));
  const token = "fixture-manager-token-".repeat(3);
  const job = {
    protocol_version: 2,
    operation: "code",
    run_id: crypto.randomUUID(),
    workspace_id: 1,
    actor_id: 1,
    capability: crypto.randomUUID(),
    inputs: {},
    deadline: new Date(Date.now() + 60_000).toISOString(),
    lease_seconds: 60,
    snapshot: {
      root_agent_id: "project",
      source: 'await writeFile("started", "yes"); while (true) {}',
      agents: [{ id: "project", name: "Project", plugins: [] }],
    },
  };
  const source =
    'import {spawn} from "node:child_process"; export const safeFunctions = [{name:"start", handler:()=>{const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});child.unref();return child.pid;}}];';
  const helperJob = structuredClone(job);
  helperJob.run_id = crypto.randomUUID();
  helperJob.snapshot.source = "return await descendant.start();";
  helperJob.snapshot.agents[0].plugins = [
    {
      distribution: "inline",
      slug: "descendant",
      version: "1",
      source,
      digest: createHash("sha256").update(source).digest("hex"),
      credential_id: null,
    },
  ];
  let helperPid;
  let bootstrapRequests = 0;
  let blockedBootstrap;
  let claimed = 0;
  let manager;
  let workerPid;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "null");
    response.setHeader("content-type", "application/json");
    if (request.url.endsWith("/bootstrap/")) {
      bootstrapRequests++;
      if (bootstrapRequests > 1) {
        blockedBootstrap = response;
        return;
      }
      response.end(
        JSON.stringify({ registrations: [{ agent_id: "project", token }] }),
      );
    } else if (request.url.endsWith("/configuration/")) {
      response.end(JSON.stringify({ agent_id: "project", plugins: [] }));
    } else if (request.url.endsWith("/claim/")) {
      response.end(JSON.stringify([helperJob, job][claimed++] ?? null));
    } else if (
      request.url.includes(helperJob.run_id) &&
      request.url.endsWith("/complete/")
    ) {
      assert.equal(body.status, "succeeded");
      helperPid = body.output.result;
      response.end("{}");
    } else if (request.url.endsWith("/heartbeat/")) {
      response.end(
        JSON.stringify({ status: "running", cancel_requested: false }),
      );
    } else response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const agent = join(directory, "agents/project");
  await mkdir(agent, { recursive: true });
  try {
    manager = spawn(
      process.execPath,
      [join(packageDirectory, "dist/cli.js"), "manage", "--mode", "host"],
      {
        env: {
          PATH: process.env.PATH,
          DJANGO_URL: `http://127.0.0.1:${server.address().port}`,
          LOCAL_EXECUTOR_BOOTSTRAP_TOKEN: token,
          EXECUTOR_DATA_DIR: directory,
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let errors = "";
    manager.stderr.on("data", (chunk) => {
      errors += chunk.toString();
    });
    const exited = new Promise((resolve, reject) => {
      manager.once("error", reject);
      manager.once("close", resolve);
    });
    const deadline = Date.now() + 15_000;
    while (!blockedBootstrap && Date.now() < deadline) await sleep(20);
    assert.ok(
      blockedBootstrap,
      `Manager did not reach blocked bootstrap: ${errors}`,
    );
    assert.equal(
      await readFile(join(agent, "workspace/started"), "utf8"),
      "yes",
    );
    assert.equal(
      typeof helperPid,
      "number",
      `Helper job did not complete: ${errors}`,
    );
    const helperStat = await readFile(`/proc/${helperPid}/stat`, "utf8").catch(
      () => undefined,
    );
    assert.ok(
      !helperStat ||
        helperStat.slice(helperStat.lastIndexOf(") ") + 2).startsWith("Z "),
      "Completed run left a live helper process",
    );
    const children = (
      await readFile(
        `/proc/${manager.pid}/task/${manager.pid}/children`,
        "utf8",
      )
    )
      .trim()
      .split(/\s+/)
      .map(Number);
    assert.equal(children.length, 1);
    workerPid = children[0];
    const workerStat = await readFile(`/proc/${workerPid}/stat`, "utf8");
    assert.equal(
      Number(workerStat.slice(workerStat.lastIndexOf(") ") + 2).split(" ")[2]),
      workerPid,
      "Job must run in a detached process group",
    );
    const stoppedAt = Date.now();
    manager.kill("SIGTERM");
    const watchdog = setTimeout(() => manager.kill("SIGKILL"), 4000);
    try {
      assert.equal(await exited, 0, errors);
    } finally {
      clearTimeout(watchdog);
    }
    assert.ok(Date.now() - stoppedAt < 4000);
    assert.throws(() => process.kill(workerPid, 0), { code: "ESRCH" });
    console.log(
      `${runtimeLabel} manager shutdown passed: completed-run helpers stop; SIGTERM aborts blocked bootstrap and terminates detached host job.`,
    );
  } finally {
    manager?.kill("SIGKILL");
    if (helperPid) {
      try {
        process.kill(helperPid, "SIGKILL");
      } catch {}
    }
    if (workerPid) {
      try {
        process.kill(-workerPid, "SIGKILL");
      } catch {}
    }
    blockedBootstrap?.end("{}");
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}
