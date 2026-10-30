import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import {
  api,
  availablePort,
  command,
  runSchema,
  startInstallation,
  waitForRun,
} from "./distribution-fixture.ts";

const packageSource = process.argv[2];
assert(
  packageSource,
  "Usage: npm run test:distribution -- PACKAGE.tgz | @orgsdk/cli@VERSION",
);
const packageSpec = packageSource.startsWith("@orgsdk/cli@")
  ? packageSource
  : resolve(packageSource);
const runtime = process.versions.bun ? "bun" : "node";
assert.equal(runtime, process.env.ORGSDK_TEST_RUNTIME ?? runtime);
console.log(
  `Testing packed platform with ${runtime} ${process.versions[runtime]}`,
);
const directory = await mkdtemp(join(tmpdir(), "orgsdk-npm-acceptance-"));
let installation: Awaited<ReturnType<typeof startInstallation>> | undefined;

try {
  const installed = join(directory, "installed");
  const runtimePath = join(directory, `${runtime}-only`);
  await mkdir(installed);
  await mkdir(runtimePath);
  await symlink(process.execPath, join(runtimePath, runtime));
  await command(
    "npm",
    [
      "install",
      "--prefix",
      installed,
      "--no-audit",
      "--no-fund",
      "--omit=dev",
      packageSpec,
    ],
    directory,
  ).success();
  const cli = join(installed, "node_modules/@orgsdk/cli/bin/orgsdk.mjs");
  const minimalEnv = { PATH: runtimePath, HOME: directory };
  assert.match(
    await command(
      process.execPath,
      [cli, "--help"],
      directory,
      minimalEnv,
    ).success(),
    /start/,
  );
  const manifest = z
    .object({ name: z.literal("@orgsdk/cli"), version: z.string() })
    .parse(
      JSON.parse(
        await readFile(
          join(installed, "node_modules/@orgsdk/cli/package.json"),
          "utf8",
        ),
      ),
    );
  assert.equal(
    (
      await command(
        process.execPath,
        [cli, "--version"],
        directory,
        minimalEnv,
      ).success()
    ).trim(),
    manifest.version,
  );
  console.log(
    `Installed ${manifest.name}@${manifest.version} from ${packageSpec}`,
  );
  const port = await availablePort();
  installation = await startInstallation(cli, directory, port, runtimePath);
  let rpc = api(installation.origin);
  const health = z
    .object({ runtime: z.string() })
    .parse(await rpc("system.health"));
  assert.equal(
    health.runtime,
    runtime,
    "Platform must use the selected runtime",
  );
  for (const path of ["/", "/setup/", "/monaco/vs/editor/editor.main.js"]) {
    const asset: Response = await fetch(`${installation.origin}${path}`);
    assert.equal(asset.status, 200, `Missing package asset: ${path}`);
    assert((await asset.arrayBuffer()).byteLength > 100);
  }
  await rpc("auth.setupStatus");
  const password = "A-strong-package-test-password-123";
  await rpc(
    "auth.setup",
    {
      domain: "127.0.0.1",
      workspace_name: `Packed ${runtime} installation`,
      username: "package-owner",
      email: "owner@example.test",
      password1: password,
      password2: password,
      project_name: "Persistent package project",
    },
    true,
  );
  await rpc("auth.login", { email: "owner@example.test", password }, true);
  const project = z
    .object({ results: z.array(z.object({ id: z.string() })) })
    .parse(await rpc("projects.list")).results[0];
  assert(project);
  async function execute(source: string) {
    const queued = runSchema.parse(
      await rpc(
        "runs.create",
        {
          project: project?.id,
          operation: "code",
          source,
          inputs: {},
          idempotency_key: randomUUID(),
        },
        true,
      ),
    );
    return waitForRun(rpc, queued.id);
  }
  const written = await execute(
    'await writeFile("npm-proof.txt", "persistent execution"); return 6 * 7;',
  );
  assert.deepEqual(written.output, { result: 42 });
  const validation = runSchema.parse(
    await rpc(
      "actions.validateCode",
      {
        project: project.id,
        source: "return 42;",
        idempotency_key: randomUUID(),
      },
      true,
    ),
  );
  await waitForRun(rpc, validation.id);
  const action = z.object({ id: z.string() }).parse(
    await rpc(
      "actions.create",
      {
        project: project.id,
        name: "Packaged answer",
      },
      true,
    ),
  );
  await rpc(
    "actions.createVersion",
    { id: action.id, source: "return 42;" },
    true,
  );
  await rpc(
    "actions.saveTests",
    {
      id: action.id,
      version: 1,
      cases: [{ name: "answer", inputs: {}, expected: 42 }],
    },
    true,
  );
  const tests = runSchema.parse(
    await rpc(
      "actions.runTests",
      {
        id: action.id,
        version: 1,
        suite_revision: 1,
        idempotency_key: randomUUID(),
      },
      true,
    ),
  );
  await waitForRun(rpc, tests.id);
  const queuedAction = runSchema.parse(
    await rpc(
      "runs.create",
      {
        project: project.id,
        operation: "action",
        action: action.id,
        version: 1,
        inputs: {},
        idempotency_key: randomUUID(),
      },
      true,
    ),
  );
  assert.deepEqual((await waitForRun(rpc, queuedAction.id)).output, {
    result: 42,
  });
  const keyBefore = await readFile(join(directory, "data/encryption.key"));
  const stoppedOrigin = installation.origin;
  await installation.stop();
  installation = undefined;
  await assert.rejects(
    fetch(`${stoppedOrigin}/trpc/system.health`, {
      signal: AbortSignal.timeout(1000),
    }),
  );
  const dataEnv = { ...minimalEnv, ORGSDK_DATA_DIR: join(directory, "data") };
  await command(
    process.execPath,
    [cli, "migrate"],
    directory,
    dataEnv,
  ).success();
  await command(
    process.execPath,
    [cli, "backup", join(directory, "backup.sqlite3")],
    directory,
    dataEnv,
  ).success();
  installation = await startInstallation(cli, directory, port, runtimePath);
  rpc = api(installation.origin);
  await rpc("auth.setupStatus");
  await rpc("auth.login", { email: "owner@example.test", password }, true);
  assert.deepEqual(
    await readFile(join(directory, "data/encryption.key")),
    keyBefore,
  );
  assert.deepEqual(
    (await execute('return await readFile("npm-proof.txt");')).output,
    { result: "persistent execution" },
  );
  const cancelled = runSchema.parse(
    await rpc(
      "runs.create",
      {
        project: project.id,
        operation: "code",
        source: 'await requestApproval("Cancel the package test"); return 1;',
        inputs: {},
        idempotency_key: randomUUID(),
      },
      true,
    ),
  );
  let executing = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = runSchema.parse(
      await rpc("runs.get", { id: cancelled.id }),
    );
    if (current.status === "waiting_approval") {
      executing = true;
      break;
    }
    await sleep(100);
  }
  assert(
    executing,
    "The executor must claim the run before cancellation is tested.",
  );
  await rpc("runs.cancel", { id: cancelled.id }, true);
  await waitForRun(rpc, cancelled.id, "cancelled");
  console.log(
    `Packed ${runtime}-only installation passed: setup, login, assets, code, validation, action tests, action execution, persistent files, restart, migration, backup, cancellation and shutdown.`,
  );
} catch (error) {
  console.error(installation?.output());
  throw error;
} finally {
  await installation?.stop();
  await rm(directory, { recursive: true, force: true });
}
