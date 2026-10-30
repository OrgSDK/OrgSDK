import { build } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "src");
const output = join(root, "dist");

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "testing")
      files.push(...(await sourceFiles(path)));
    else if (entry.isFile() && !entry.name.endsWith(".test.ts"))
      files.push(path);
  }
  return files;
}

await rm(output, { recursive: true, force: true });
const files = await sourceFiles(source);
await build({
  entryPoints: files.filter(
    (path) => path.endsWith(".ts") && !path.endsWith(".d.ts"),
  ),
  outbase: source,
  outdir: output,
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  packages: "external",
  plugins: [
    {
      name: "portable-relative-imports",
      setup(builder) {
        builder.onResolve({ filter: /^\./ }, (args) => {
          let target = resolve(dirname(args.importer), args.path);
          if (!extname(target))
            target = existsSync(`${target}.ts`)
              ? `${target}.ts`
              : join(target, "index.ts");
          const path = args.path.endsWith(".mjs")
            ? args.path
            : relative(dirname(args.importer), target).replace(/\.ts$/, ".js");
          return {
            path: path.startsWith(".") ? path : `./${path}`,
            external: true,
          };
        });
      },
    },
  ],
});
for (const path of files.filter(
  (path) => path.endsWith(".d.ts") || path.endsWith(".mjs"),
)) {
  const target = join(output, relative(source, path));
  await mkdir(dirname(target), { recursive: true });
  await cp(path, target);
}
