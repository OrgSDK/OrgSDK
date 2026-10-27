import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { z } from "zod";

const packageSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  license: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
});

async function packageDirectory(name: string, from: string): Promise<string> {
  const require = createRequire(join(from, "package.json"));
  let entry: string;
  try {
    return await realpath(dirname(require.resolve(`${name}/package.json`)));
  } catch {
    entry = require.resolve(name);
  }
  let directory = dirname(entry);
  while (true) {
    try {
      const metadata = packageSchema.parse(
        JSON.parse(await readFile(join(directory, "package.json"), "utf8")),
      );
      if (metadata.name === name) return realpath(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate package ${name}`);
    directory = parent;
  }
}

async function packageFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Cannot embed a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...(await packageFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function dependencyDirectories(
  checkout: string,
  names: string[],
): Promise<Map<string, string>> {
  const dependencies = new Map<string, string>();
  const collect = async (name: string, from: string): Promise<void> => {
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))
      throw new Error("Embedded dependency must be an npm package name");
    const directory = await packageDirectory(name, from);
    if (dependencies.has(directory)) return;
    const path = relative(join(checkout, "node_modules"), directory);
    if (path.startsWith("..") || path.startsWith(sep))
      throw new Error(
        "Embedded dependencies must be installed inside the plugin checkout",
      );
    dependencies.set(directory, join("node_modules", path));
    const metadata = packageSchema.parse(
      JSON.parse(await readFile(join(directory, "package.json"), "utf8")),
    );
    for (const dependency of Object.keys(metadata.dependencies ?? {}))
      await collect(dependency, directory);
    for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) {
      try {
        await packageDirectory(dependency, directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND")
          continue;
        throw error;
      }
      await collect(dependency, directory);
    }
  };
  for (const name of names) await collect(name, checkout);
  return dependencies;
}

export async function dependencyNotices(checkout: string): Promise<string> {
  const metadata = packageSchema.parse(
    JSON.parse(await readFile(join(checkout, "package.json"), "utf8")),
  );
  const dependencies = await dependencyDirectories(
    checkout,
    Object.keys(metadata.dependencies ?? {}),
  );
  const notices: string[] = [];
  for (const directory of [...dependencies.keys()].sort()) {
    const pkg = packageSchema.parse(
      JSON.parse(await readFile(join(directory, "package.json"), "utf8")),
    );
    const files = (await readdir(directory))
      .filter((name) => /^(licen[sc]e|notice|copying)([.-]|$)/i.test(name))
      .sort();
    notices.push(
      `${pkg.name}@${pkg.version ?? "unknown"} (${pkg.license ?? "see accompanying notices"})`,
    );
    for (const file of files)
      notices.push(await readFile(join(directory, file), "utf8"));
    if (!files.length) {
      const readme = await readFile(join(directory, "README.md"), "utf8").catch(
        () => "",
      );
      if (!readme.includes("Permission is hereby granted"))
        throw new Error(`Missing dependency license text: ${pkg.name}`);
      notices.push(readme);
    }
  }
  return notices.join("\n\n");
}

export async function embedPluginDependencies(
  checkout: string,
  entry: Uint8Array,
  names: string[],
): Promise<Uint8Array> {
  const dependencies = await dependencyDirectories(checkout, names);
  const files: [string, string, string][] = [];
  const add = (path: string, bytes: Uint8Array): void => {
    files.push([
      path.split(sep).join("/"),
      Buffer.from(bytes).toString("base64"),
      createHash("sha256").update(bytes).digest("hex"),
    ]);
  };
  add("entry.mjs", entry);
  for (const [directory, target] of dependencies) {
    for (const path of await packageFiles(directory))
      add(join(target, relative(directory, path)), await readFile(path));
  }
  files.sort(([left], [right]) => left.localeCompare(right, "en"));
  const payload = gzipSync(JSON.stringify(files), { level: 9 }).toString(
    "base64",
  );
  const loader = await readFile(
    new URL("./embedded-plugin-loader.mjs", import.meta.url),
    "utf8",
  );
  return new TextEncoder().encode(
    `${loader}\nexport default await loadEmbeddedPlugin(${JSON.stringify(payload)}, import.meta.url);\n`,
  );
}
