#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const version = spawnSync("bun", ["--version"], { encoding: "utf8" });
if (version.error || !/^1\.4\./.test(version.stdout.trim())) {
  console.error("orgsdk-executor requires Bun 1.4.x installed on PATH.");
  process.exit(1);
}
const child = spawnSync(
  "bun",
  [
    "--no-env-file",
    fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
process.exit(child.status ?? 1);
