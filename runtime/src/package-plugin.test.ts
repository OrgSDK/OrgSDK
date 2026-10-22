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
