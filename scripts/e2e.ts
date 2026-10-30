import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startTestMailbox } from "./e2e-mail";

const dataDir = await mkdtemp(join(tmpdir(), "orgsdk-e2e-"));
const port = process.env.ORGSDK_E2E_PORT ?? "18783";
const url = `http://127.0.0.1:${port}`;
const binary = process.env.ORGSDK_E2E_BINARY;
const entry = process.env.ORGSDK_E2E_ENTRY ?? process.env.ORGSDK_E2E_NODE_ENTRY;
const runtimeName = process.env.ORGSDK_E2E_RUNTIME ?? "node";
if (runtimeName !== "node" && runtimeName !== "bun") {
  throw new Error("ORGSDK_E2E_RUNTIME must be node or bun.");
}
const runtime = entry ? Bun.which(runtimeName) : undefined;
if (entry && !runtime) {
  throw new Error(`${runtimeName} is required for these browser tests.`);
}
const command = binary
  ? [resolve(binary)]
  : entry && runtime
    ? [runtime, resolve(entry)]
    : ["bun", "server/index.ts"];
const catalog = join(dataDir, "plugin-catalog.json");
await writeFile(catalog, "[]");
const mailbox = await startTestMailbox(dataDir);
const server = Bun.spawn(command, {
  ...(binary || entry ? { cwd: dataDir } : {}),
  env: {
    ...process.env,
    ORGSDK_DATA_DIR: dataDir,
    HOST: "127.0.0.1",
    PORT: port,
    PLUGIN_CATALOG_PATH: catalog,
    PLUGIN_MARKETPLACE_URL: "",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(mailbox.port),
    SMTP_FROM: "noreply@example.test",
    SMTP_SECURE: "true",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    NODE_EXTRA_CA_CERTS: mailbox.certificate,
  },
  stdout: "inherit",
  stderr: "inherit",
});
try {
  let ready = false;
  for (let attempts = 0; attempts < 100; attempts++) {
    if (server.exitCode !== null) {
      throw new Error("Test server exited before it was ready");
    }
    try {
      const response = await fetch(`${url}/trpc/system.health`);
      if (!response.ok) {
        throw new Error("Test API is not ready.");
      }
      ready = true;
      break;
    } catch {
      await Bun.sleep(100);
    }
  }
  if (!ready) {
    throw new Error("Test server did not become ready");
  }
  const test = Bun.spawn(
    ["bunx", "playwright", "test", ...process.argv.slice(2)],
    {
      env: {
        ...process.env,
        ORGSDK_E2E_URL: url,
        ORGSDK_E2E_DATA_DIR: dataDir,
        ORGSDK_E2E_OUTPUT_DIR:
          process.env.ORGSDK_E2E_OUTPUT_DIR ??
          `test-results/${binary ? "binary" : entry ? runtimeName : "source"}`,
        ORGSDK_E2E_BUN: Bun.which("bun") ?? "bun",
        ...(entry && runtime
          ? {
              ORGSDK_E2E_WORKER_RUNTIME: runtime,
              ORGSDK_E2E_WORKER_ENTRY: resolve("dist/runtime/worker.js"),
            }
          : {}),
      },
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    },
  );
  process.exitCode = await test.exited;
} finally {
  server.kill();
  await server.exited;
  await mailbox.close();
  await rm(dataDir, { recursive: true, force: true });
}
