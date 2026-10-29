import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const runtime = process.argv[2];
if (runtime !== "node" && runtime !== "bun") {
  throw new Error("Choose the executor runtime: node or bun");
}
let executable = process.execPath;
if (runtime === "bun") {
  const probe = spawnSync(
    "bun",
    ["--no-env-file", "--print", "process.execPath"],
    { encoding: "utf8" },
  );
  if (probe.error || probe.status !== 0)
    throw new Error("Bun must be installed for smoke:bun");
  executable = probe.stdout.trim();
}

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "orgsdk-executor-package-"));
const installation = join(directory, "installation");
const environment = { ...process.env };
if (runtime === "node") {
  const directories = [];
  for (const path of (process.env.PATH ?? "").split(delimiter)) {
    try {
      await access(join(path, "bun"));
    } catch {
      directories.push(path);
    }
  }
  environment.PATH = directories.join(delimiter);
}

function run(command, args, cwd = root, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

try {
  const packed = JSON.parse(
    await run(
      "npm",
      ["pack", "--json", "--pack-destination", directory],
      root,
      true,
    ),
  );
  await run("npm", [
    "install",
    "--prefix",
    installation,
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, packed[0].filename),
  ]);
  await run(executable, [
    ...(runtime === "bun" ? ["--no-env-file"] : []),
    join(root, "scripts/smoke-runtime.mjs"),
    join(installation, "node_modules/@orgsdk/executor"),
    runtime,
  ]);
} finally {
  await rm(directory, { recursive: true, force: true });
}
