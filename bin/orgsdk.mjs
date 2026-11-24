#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bootstrapToken,
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
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const data =
    options.data ??
    resolve(
      process.env.ORGSDK_DATA_DIR || join(homedir(), ".local/share/orgsdk"),
    );
  const launcher = new URL("../dist/launcher/updates.js", import.meta.url);
  const updates = existsSync(launcher)
    ? await import(launcher.href)
    : undefined;
  const cli = fileURLToPath(import.meta.url);
  if (updates && cli.endsWith("/node_modules/@orgsdk/cli/bin/orgsdk.mjs")) {
    const selected = await updates.selectedCli(data, manifest.version);
    if (selected) {
      await import(pathToFileURL(selected).href);
      return process.exitCode ?? 0;
    }
  }
  if (options.command === "version") {
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
  if (options.port) {
    env.PORT = options.port;
  } else {
    delete env.PORT;
  }
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
  env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN = await bootstrapToken(options.data);
  env.EXECUTOR_DATA_DIR ||= join(options.data, "executor");
  if (options.mode === "host") {
    console.log(
      "Local executor: project code runs with your current user's host privileges. Use trusted code and clients only.",
    );
  }
  console.log(`Installation data: ${options.data}`);
  const manager = await updates?.updateManager(
    data,
    options.host,
    env.EXECUTOR_DATA_DIR,
    options.mode,
    cli,
  );
  env.ORGSDK_MANAGED_UPDATES = manager ? "1" : "";
  for (;;) {
    let target;
    const status = await supervise({
      server,
      executor,
      executorArgs: ["manage", "--mode", options.mode],
      env,
      onUpdate: manager
        ? (version, port) => {
            target = version;
            env.PORT = String(port);
          }
        : undefined,
    });
    if (!target || status !== 0) {
      return status;
    }
    let selected;
    try {
      selected = await updates.installSelectedRelease(
        manager,
        data,
        server,
        manifest.version,
        target,
      );
    } catch (error) {
      console.error(
        "Update failed. Restarting the current release.",
        error.message,
      );
      env.ORGSDK_FAILED_UPDATE = target;
      continue;
    }
    process.env.PORT = env.PORT;
    delete process.env.ORGSDK_FAILED_UPDATE;
    console.log("Starting OrgSDK " + target);
    await import(pathToFileURL(selected).href);
    return process.exitCode ?? 0;
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "OrgSDK failed to start.",
  );
  process.exitCode = 1;
}
