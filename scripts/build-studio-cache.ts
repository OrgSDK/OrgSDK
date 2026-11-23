import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(process.argv[2] ?? "frontend/dist/studio");
const worker = "frontend/src/studio-worker.mts";
const assets: Record<string, string> = {};
for (const file of (await readdir(root, { recursive: true })).sort()) {
  if (
    !/\.(?:js|css|html|txt|svg|png|webp|ico|woff2?|ttf|wasm|json)$/.test(
      file,
    ) ||
    file === "sw.js" ||
    file.startsWith("404") ||
    file.startsWith("_not-found/")
  ) {
    continue;
  }
  // Deployment hosts serve directory indexes at their canonical URLs.
  const path =
    "/" +
    (file.endsWith("/index.html") || file === "index.html"
      ? file.slice(0, -"index.html".length)
      : file);
  assets[path] =
    "sha256-" +
    createHash("sha256")
      .update(await readFile(join(root, file)))
      .digest("base64");
}
if (
  !assets["/"] ||
  !assets["/actions/"] ||
  !assets["/monaco/vs/loader.js"] ||
  assets["/studio/approve/"]
) {
  throw new Error("Expected a workspace-only Studio export.");
}
const version = createHash("sha256")
  .update(JSON.stringify(assets))
  .update(await readFile(worker))
  .digest("hex");
await build({
  entryPoints: [worker],
  outfile: join(root, "sw.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  define: {
    STUDIO_ASSETS: JSON.stringify(assets),
    STUDIO_VERSION: JSON.stringify(version),
  },
});
await writeFile(join(root, "_headers"), "/sw.js\n  Cache-Control: no-cache\n");
console.log(
  `Studio cache includes ${Object.keys(assets).length} static files.`,
);
