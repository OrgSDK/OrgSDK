import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "orgsdk-e2e-"));
const port = process.env.ORGSDK_E2E_PORT ?? "18783";
const url = `http://127.0.0.1:${port}`;
const binary = process.env.ORGSDK_E2E_BINARY;
const server = Bun.spawn(
  binary ? [resolve(binary)] : ["bun", "server/index.ts"],
  {
    ...(binary ? { cwd: dataDir } : {}),
    env: {
      ...process.env,
      ORGSDK_DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: port,
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
try {
  let ready = false;
  for (let attempts = 0; attempts < 100; attempts++) {
    if (server.exitCode !== null)
      throw new Error("Test server exited before it was ready");
    try {
      await fetch(url);
      ready = true;
      break;
    } catch {
      await Bun.sleep(100);
    }
  }
  if (!ready) throw new Error("Test server did not become ready");
  const test = Bun.spawn(
    ["bunx", "playwright", "test", ...process.argv.slice(2)],
    {
      env: { ...process.env, ORGSDK_E2E_URL: url },
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    },
  );
  process.exitCode = await test.exited;
} finally {
  server.kill();
  await server.exited;
  await rm(dataDir, { recursive: true, force: true });
}
