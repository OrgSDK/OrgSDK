#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  bootstrapToken,
  localAddress,
  requireAvailablePort,
  requireDockerConfiguration,
} from "./configuration.mjs";
import { help, parseArguments } from "./options.mjs";
import { supervise } from "./supervision.mjs";

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === "help") {
    console.log(help);
    return 0;
  }
  if (options.command === "version") {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    console.log(manifest.version);
    return 0;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 22)) {
    throw new Error("OrgSDK requires Node.js 22.22.0 or newer.");
  }
  if (process.platform !== "linux") {
    throw new Error(
      "OrgSDK currently supports Linux; executor file isolation requires /proc.",
    );
  }
  const server = fileURLToPath(
    new URL("../dist/server/index.js", import.meta.url),
  );
  const executor = fileURLToPath(
    new URL("../dist/runtime/cli.js", import.meta.url),
  );
  const entry = options.command === "executor" ? executor : server;
  if (
    !existsSync(entry) ||
    (options.command === "start" && !existsSync(executor))
  ) {
    throw new Error(
      "Package distribution is missing. In a source checkout, run npm run build:npm.",
    );
  }
  const env = { ...process.env, ORGSDK_DATA_DIR: options.data };
  if (options.command === "executor") {
    env.EXECUTOR_DATA_DIR ||= join(options.data, "executor");
    return supervise({ server: executor, serverArgs: options.args, env });
  }
  env.HOST = options.host;
  env.PORT = options.port;
  if (options.command !== "start") {
    return supervise({
      server,
      serverArgs: [options.command, ...options.args],
      env,
    });
  }
  if (options.mode === "docker") {
    requireDockerConfiguration(env);
  }
  await requireAvailablePort(options.host, options.port);
  env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN = await bootstrapToken(options.data);
  env.EXECUTOR_DATA_DIR ||= join(options.data, "executor");
  const address = localAddress(options.host, options.port);
  env.DJANGO_URL = address;
  if (options.mode === "host") {
    console.log(
      "Local executor: project code runs with your current user's host privileges. Use trusted code and clients only.",
    );
  }
  console.log(`Installation data: ${options.data}`);
  return supervise({
    server,
    executor,
    executorArgs: ["manage", "--mode", options.mode],
    env,
    address,
  });
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "OrgSDK failed to start.",
  );
  process.exitCode = 1;
}
