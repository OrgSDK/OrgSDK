import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "../server/router";
import { availablePort, command } from "./distribution-fixture";

const directory = await mkdtemp(join(tmpdir(), "orgsdk-dev-smoke-"));
const apiPort = await availablePort();
const uiPort = await availablePort();
const nextPort = await availablePort();
const origin = `http://localhost:${uiPort}`;
const env = {
  ...process.env,
  ORGSDK_DEV_DATA_DIR: directory,
  ORGSDK_DEV_API_PORT: String(apiPort),
  ORGSDK_DEV_UI_PORT: String(uiPort),
  ORGSDK_DEV_NEXT_PORT: String(nextPort),
  PLUGIN_CATALOG_URL: "",
  PLUGIN_MARKETPLACE_URL: "",
};
const cookies = new Map<string, string>();
const client = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: `${origin}/trpc`,
      async fetch(input, init) {
        const headers = new Headers(init?.headers);
        headers.set("origin", origin);
        headers.set(
          "cookie",
          [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
        );
        headers.set("x-csrftoken", cookies.get("csrftoken") ?? "");
        const response = await fetch(input, {
          ...init,
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(";")[0];
          assert(pair);
          const separator = pair.indexOf("=");
          cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
        return response;
      },
    }),
  ],
});
async function launch() {
  const dev = command(
    "bun",
    ["--no-env-file", "scripts/dev.ts"],
    process.cwd(),
    env,
  );
  try {
    for (let attempt = 0; attempt < 300; attempt++) {
      assert.equal(dev.child.exitCode, null, dev.output());
      try {
        const response = await fetch(`${origin}/setup/`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          assert((await response.text()).includes("<html"));
          return dev;
        }
      } catch {
        // Next compiles its first page after the proxy starts.
      }
      await sleep(200);
    }
    throw new Error(`Development UI did not start:\n${dev.output()}`);
  } catch (error) {
    await dev.stop();
    throw error;
  }
}
let dev: Awaited<ReturnType<typeof launch>> | undefined;
async function waitForRun(id: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const run = await client.runs.get.query({ id });
    if (
      ["succeeded", "failed", "cancelled", "timed_out"].includes(run.status)
    ) {
      assert.equal(run.status, "succeeded", JSON.stringify(run));
      return run;
    }
    await sleep(200);
  }
  throw new Error("Development runner did not finish its job.");
}
try {
  dev = await launch();
  await client.auth.setupStatus.query();
  const password = "Development-Smoke_Password42!";
  await client.auth.setup.mutate({
    domain: "localhost",
    workspace_name: "Disposable development",
    username: "dev-owner",
    email: "dev@example.test",
    password1: password,
    password2: password,
    project_name: "Dev project",
  });
  await client.auth.login.mutate({ email: "dev@example.test", password });
  const project = (await client.projects.list.query()).results[0];
  assert(project);
  const run = await client.runs.create.mutate({
    project: project.id,
    operation: "code",
    source: 'await writeFile("dev-proof.txt", "persistent"); return 6 * 7;',
    inputs: {},
    idempotency_key: crypto.randomUUID(),
  });
  assert.deepEqual((await waitForRun(run.id)).output, { result: 42 });
  const validation = await client.actions.validateCode.mutate({
    project: project.id,
    source: "return 42;",
    idempotency_key: crypto.randomUUID(),
  });
  await waitForRun(validation.id);
  await dev.stop();
  dev = undefined;
  for (const port of [apiPort, uiPort, nextPort]) {
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/trpc/system.health`, {
        signal: AbortSignal.timeout(500),
      }),
    );
  }
  dev = await launch();
  assert.equal((await client.auth.setupStatus.query()).setup_required, false);
  const read = await client.runs.create.mutate({
    project: project.id,
    operation: "code",
    source: 'return await readFile("dev-proof.txt");',
    inputs: {},
    idempotency_key: crypto.randomUUID(),
  });
  assert.deepEqual((await waitForRun(read.id)).output, {
    result: "persistent",
  });
  console.log(
    "Development flow passed: proxied setup/login, automatic local execution, validation, shutdown, restart and persistent project files.",
  );
} finally {
  await dev?.stop();
  await rm(directory, { recursive: true, force: true });
}
