import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "orgsdk-executor-package-"));
const installation = join(directory, "installation");
const directories = [];
for (const path of (process.env.PATH ?? "").split(delimiter)) {
  try {
    await access(join(path, "bun"));
  } catch {
    directories.push(path);
  }
}
const environment = { ...process.env, PATH: directories.join(delimiter) };

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
  await run(process.execPath, [
    join(root, "scripts/smoke-node.mjs"),
    join(installation, "node_modules/@orgsdk/executor"),
  ]);
} finally {
  await rm(directory, { recursive: true, force: true });
}
