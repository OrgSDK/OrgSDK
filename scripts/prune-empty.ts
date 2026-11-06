import { readdir, rmdir } from "node:fs/promises";
import { join } from "node:path";

// Only source folders: installation data, dependencies, Git and build outputs are excluded.
const roots = [
  "server",
  "runtime/src",
  "runtime/scripts",
  "frontend/src",
  "frontend/tests",
  "frontend/scripts",
  "scripts",
  "e2e",
  "docs",
];
async function prune(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await prune(join(directory, entry.name));
    }
  }
  if ((await readdir(directory)).length === 0) {
    await rmdir(directory);
    console.log(`Removed ${directory}`);
  }
}
for (const root of roots) {
  await prune(root);
}
