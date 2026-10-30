import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["--prefix", "frontend", "run", "build"], {
  stdio: "inherit",
});
execFileSync(npm, ["--prefix", "runtime", "run", "build"], {
  stdio: "inherit",
});
await rm("dist/server", { recursive: true, force: true });
await rm("dist/runtime", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await build({
  entryPoints: ["server/index.ts"],
  outdir: "dist/server",
  bundle: true,
  platform: "node",
  target: "node22.22",
  format: "esm",
  splitting: true,
  packages: "external",
  external: ["bun:*"],
});
await cp("frontend/out", "dist/server/out", { recursive: true });
await cp("server/db/migrations", "dist/server/migrations", { recursive: true });
await cp("runtime/dist", "dist/runtime", { recursive: true });
for (const filename of ["LICENSE", "PROVENANCE.md", "README.md"]) {
  await cp(`runtime/${filename}`, `dist/runtime/${filename}`);
}
console.log(
  "Built npm distribution: platform, frontend, migrations and Node.js executor.",
);
