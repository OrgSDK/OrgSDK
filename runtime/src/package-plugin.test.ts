import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packagePlugin } from "./package-plugin";
import { pluginSchema } from "./contract";
import { loadPlugins } from "./plugins";
import { Client } from "./client";

test("canonical checkout adapter produces installable factory plugin", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-package-test-"));
  const previous = process.env.EXECUTOR_DATA_DIR;
  process.env.EXECUTOR_DATA_DIR = join(root, "state");
  try {
    await writeFile(
      join(root, ".plugin.json"),
      JSON.stringify({
        name: "@orgsdk/orgsdk-plugin-fixture",
        version: "1.0.0",
        entry: "index.ts",
        tools: ["hello"],
      }),
    );
    await writeFile(
      join(root, "index.ts"),
      `export default (context: any) => ({ safeFunctions: [{name:'hello', handler: async () => (await context.stores.config.get('plugin:fixture')).value.greeting}] });`,
    );
    await packagePlugin(root, join(root, "release"));
    const manifest = JSON.parse(
      await readFile(join(root, "release/fixture.manifest.json"), "utf8"),
    );
    expect(manifest.metadata.tools).toEqual(["hello"]);
    const source = await readFile(join(root, "release/fixture.mjs"), "utf8");
    const plugin = pluginSchema.parse({
      ...manifest,
      distribution: "inline",
      source,
      configuration: { greeting: "hello persistent plugins" },
    });
    const functions = await loadPlugins(
      [plugin],
      new Client("http://unused", "unused"),
      "agent-one",
    );
    expect(await functions[0]!.handler()).toBe("hello persistent plugins");
  } finally {
    if (previous === undefined) delete process.env.EXECUTOR_DATA_DIR;
    else process.env.EXECUTOR_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("embedded dependencies carry file assets into an isolated install and reject tampering", async () => {
  const { mkdir, rename, readdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "orgsdk-embedded-plugin-"));
  const previous = process.env.EXECUTOR_DATA_DIR;
  process.env.EXECUTOR_DATA_DIR = join(root, "runner");
  try {
    const dependency = join(root, "node_modules", "fixture-assets");
    await mkdir(dependency, { recursive: true });
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({
        name: "fixture-assets",
        version: "1.0.0",
        type: "module",
        main: "index.js",
      }),
    );
    await writeFile(
      join(dependency, "index.js"),
      `import { readFileSync } from 'node:fs'; export const readMessage = () => readFileSync(new URL('./message.txt', import.meta.url), 'utf8');`,
    );
    await writeFile(
      join(dependency, "message.txt"),
      "standalone dependency asset",
    );
    await writeFile(
      join(root, ".plugin.json"),
      JSON.stringify({ name: "embedded", version: "1.0.0", entry: "index.ts" }),
    );
    await writeFile(
      join(root, "index.ts"),
      `import { readMessage } from 'fixture-assets'; export const safeFunctions = [{ name: 'readMessage', handler: readMessage }];`,
    );
    const output = join(root, "release");
    await packagePlugin(root, output, ["fixture-assets"]);
    const manifest = pluginSchema.parse(
      JSON.parse(
        await readFile(join(output, "embedded.manifest.json"), "utf8"),
      ),
    );
    await rename(join(root, "node_modules"), join(root, "hidden-dependencies"));
    const { installPlugin } = await import("./plugin-store");
    const installed = await installPlugin(
      manifest,
      "isolated-project",
      join(output, "embedded.mjs"),
    );
    const functions = await loadPlugins(
      [manifest],
      new Client("http://unused", "unused"),
      "isolated-project",
    );
    expect(await functions[0]!.handler()).toBe("standalone dependency asset");
    const embeddedRoot = join(installed, "..", ".embedded");
    const [digest] = await readdir(embeddedRoot);
    await writeFile(
      join(embeddedRoot, digest!, "node_modules/fixture-assets/message.txt"),
      "corrupted bytes",
    );
    const imported = Bun.spawnSync([
      process.execPath,
      "--no-env-file",
      "-e",
      `await import(${JSON.stringify(installed)});`,
    ]);
    expect(imported.exitCode).not.toBe(0);
    expect(imported.stderr.toString()).toContain(
      "Embedded plugin dependency digest mismatch",
    );
  } finally {
    if (previous === undefined) delete process.env.EXECUTOR_DATA_DIR;
    else process.env.EXECUTOR_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
