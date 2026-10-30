import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";
import {
  bootstrapToken,
  localAddress,
  requireAvailablePort,
  requireDockerConfiguration,
} from "./configuration.mjs";
import { parseArguments } from "./options.mjs";

test("start defaults to loopback and a persistent installation outside cwd", () => {
  const options = parseArguments([], {});
  assert.equal(options.command, "start");
  assert.equal(options.mode, "host");
  assert.equal(options.host, "127.0.0.1");
  assert.ok(options.data.endsWith("/.local/share/orgsdk"));
  assert.equal(parseArguments(["server", "--port", "8123"], {}).port, "8123");
  assert.deepEqual(
    parseArguments(["executor", "start", "--mode", "host"], {}).args,
    ["start", "--mode", "host"],
  );
});

test("reject invalid arguments before creating installation data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orgsdk-cli-invalid-"));
  const data = join(directory, "unused");
  try {
    for (const args of [
      ["launch"],
      ["--port", "NaN"],
      ["--port", "65536"],
      ["--port"],
      ["--data", "-h"],
      ["--mode", "unsafe"],
      ["--host", "foo/bar"],
      ["server", "--mode", "host"],
      ["--unknown"],
      ["--port", "1234", "--port", "2345"],
      ["backup"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [new URL("./orgsdk.mjs", import.meta.url).pathname, ...args],
        {
          env: { ...process.env, ORGSDK_DATA_DIR: data },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.equal(existsSync(data), false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bootstrap credential is private and stable over launches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orgsdk-cli-token-"));
  try {
    const first = await bootstrapToken(directory);
    assert.match(first, /^[a-f\d]{64}$/);
    assert.equal(await bootstrapToken(directory), first);
    assert.equal(
      await readFile(join(directory, "local-executor.token"), "utf8"),
      first,
    );
    assert.equal(
      (await stat(join(directory, "local-executor.token"))).mode & 0o777,
      0o600,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("occupied listen port is rejected before startup", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      requireAvailablePort("127.0.0.1", server.address().port),
      { code: "EADDRINUSE" },
    );
    assert.equal(localAddress("::", 8080), "http://127.0.0.1:8080");
    assert.equal(localAddress("::1", 8080), "http://[::1]:8080");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Docker mode requires explicit image, networking and project mount configuration", () => {
  assert.throws(() => requireDockerConfiguration({}), /EXECUTOR_IMAGE/);
  assert.throws(
    () => requireDockerConfiguration({ EXECUTOR_IMAGE: "runner" }),
    /EXECUTION_NETWORK/,
  );
  assert.throws(
    () =>
      requireDockerConfiguration({
        EXECUTOR_IMAGE: "runner",
        EXECUTION_NETWORK: "host",
      }),
    /EXECUTOR_DATA_BIND/,
  );
  assert.doesNotThrow(() =>
    requireDockerConfiguration({
      EXECUTOR_IMAGE: "runner",
      EXECUTION_NETWORK: "host",
      EXECUTOR_DATA_BIND: "1",
    }),
  );
});
