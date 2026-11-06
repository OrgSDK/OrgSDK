import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { z } from "zod";
import { startChild, stopChildren, waitForHealth } from "./dev-process";

const portSchema = z.coerce.number().int().min(1).max(65535);
const apiPort = portSchema.parse(process.env.ORGSDK_DEV_API_PORT ?? 8081);
const uiPort = portSchema.parse(process.env.ORGSDK_DEV_UI_PORT ?? 3000);
const nextPort = portSchema.parse(process.env.ORGSDK_DEV_NEXT_PORT ?? 3001);
if (new Set([apiPort, uiPort, nextPort]).size !== 3) {
  throw new Error("The API, UI and Next server need different ports.");
}
const host = process.env.ORGSDK_DEV_HOST ?? "127.0.0.1";
const data = resolve(process.env.ORGSDK_DEV_DATA_DIR ?? ".runtime/dev");
const address = `http://127.0.0.1:${apiPort}`;
for (const [hostname, port] of [
  ["127.0.0.1", apiPort],
  [host, uiPort],
  ["127.0.0.1", nextPort],
] as const) {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, hostname, resolve);
  });
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
}
const env = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: String(apiPort),
  ORGSDK_DATA_DIR: data,
  ORGSDK_PUBLIC_ORIGIN:
    process.env.ORGSDK_DEV_ORIGIN ?? `http://localhost:${uiPort}`,
  ORGSDK_SERVER_URL: address,
  ORGSDK_DEV_HOST: host,
  ORGSDK_DEV_UI_PORT: String(uiPort),
  ORGSDK_DEV_NEXT_PORT: String(nextPort),
  LOCAL_EXECUTOR_BOOTSTRAP_TOKEN: randomBytes(32).toString("hex"),
  EXECUTOR_DATA_DIR: resolve(data, "executor"),
};
const children: ReturnType<typeof startChild>[] = [];
const controller = new AbortController();
let exitCode = 1;
const interrupt = () => {
  exitCode = 130;
  controller.abort();
};
const terminate = () => {
  exitCode = 143;
  controller.abort();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", terminate);
try {
  const server = startChild(
    "bun",
    ["--no-env-file", "--watch", "server/index.ts"],
    env,
  );
  children.push(server);
  await Promise.race([
    waitForHealth(address, controller.signal, env.ORGSDK_PUBLIC_ORIGIN),
    server.closed.then(() => {
      throw new Error("Development API exited before readiness.");
    }),
  ]);
  controller.signal.throwIfAborted();
  children.push(
    startChild(
      "bun",
      [
        "--no-env-file",
        "--watch",
        "runtime/src/cli.ts",
        "manage",
        "--mode",
        "host",
      ],
      env,
    ),
  );
  children.push(
    startChild(
      "npm",
      [
        "--prefix",
        "frontend",
        "run",
        "dev",
        "--",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(nextPort),
      ],
      env,
    ),
  );
  children.push(
    startChild("bun", ["--no-env-file", "scripts/dev-proxy.ts"], env),
  );
  console.log(
    `Development UI: http://localhost:${uiPort}\nAPI: ${address}\nData: ${data}\nLocal executor runs trusted project code with your host privileges.`,
  );
  await Promise.race([
    ...children.map((child) =>
      child.closed.then((code) => {
        if (!controller.signal.aborted) {
          exitCode = code || 1;
        }
      }),
    ),
    new Promise<void>((resolve) =>
      controller.signal.addEventListener("abort", () => resolve(), {
        once: true,
      }),
    ),
  ]);
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(
      error instanceof Error ? error.message : "Development startup failed.",
    );
  }
} finally {
  await stopChildren(children);
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
}
process.exitCode = exitCode;
