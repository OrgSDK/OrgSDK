import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const suite = process.argv[2];
if (suite !== "unit" && suite !== "integration") {
  throw new Error("Choose unit or integration tests.");
}
const roots = process.argv.slice(3);
if (roots.length === 0) {
  throw new Error("Provide at least one test directory.");
}
async function tests(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await tests(path)));
      continue;
    }
    if (!/\.test\.(ts|mjs)$/.test(entry.name)) {
      continue;
    }
    const integration = entry.name.includes(".int.test.");
    if (integration === (suite === "integration")) {
      files.push(resolve(path));
    }
  }
  return files;
}
const files = (await Promise.all(roots.map(tests))).flat().sort();
if (files.length === 0) {
  throw new Error(`No ${suite} tests found in ${roots.join(", ")}`);
}
console.log(`Running ${files.length} ${suite} test files.`);
const child = Bun.spawn([process.execPath, "test", ...files], {
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});
process.exitCode = await child.exited;
