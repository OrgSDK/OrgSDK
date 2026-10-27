import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Client } from "../src/client";
import { pluginSchema } from "../src/contract";
import { installPlugin } from "../src/plugin-store";
import { loadPlugins } from "../src/plugins";
import { SandboxExecutor } from "../src/engine/sandbox/executor";

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}
const catalog = option("catalog");
if (!catalog)
  throw new Error(
    "Use --catalog FILE_OR_HTTPS_URL [--bundle-root DIR] [--render-pdf] [--report FILE]",
  );
const input = catalog.startsWith("https://")
  ? await (async () => {
      const response = await fetch(catalog);
      if (!response.ok)
        throw new Error(`Catalog unavailable: ${response.status}`);
      return response.text();
    })()
  : await readFile(resolve(catalog), "utf8");
const entries = z
  .array(
    z
      .object({
        slug: z.string(),
        version: z.string(),
        digest: z.string(),
        package_url: z.string(),
        auth: z.object({ provider: z.string().optional() }).passthrough(),
        tools: z.array(z.object({ name: z.string() })),
      })
      .passthrough(),
  )
  .parse(JSON.parse(input));
const bundleRoot = option("bundle-root");
const state = await mkdtemp(join(tmpdir(), "orgsdk-release-verification-"));
const previous = process.env.EXECUTOR_DATA_DIR;
process.env.EXECUTOR_DATA_DIR = state;
const results: {
  slug: string;
  version: string;
  digest: string;
  tool_count: number;
  installed: boolean;
}[] = [];
try {
  for (const entry of entries) {
    const plugin = pluginSchema.parse({
      ...entry,
      source: "",
      credential_id: null,
      credential_provider: entry.auth.provider,
    });
    const local = bundleRoot
      ? join(resolve(bundleRoot), entry.slug, `${entry.slug}.mjs`)
      : undefined;
    await installPlugin(plugin, "orgsdk-platform-test", local);
    const functions = await loadPlugins(
      [plugin],
      new Client("http://unused", "unused"),
      "orgsdk-platform-test",
    );
    const expected = new Set(entry.tools.map((tool) => tool.name));
    if (
      functions.length !== expected.size ||
      functions.some((fn) => !expected.has(fn.name))
    )
      throw new Error(`Exported tools differ from catalog: ${entry.slug}`);
    if (entry.slug === "data") {
      const executor = new SandboxExecutor();
      executor.registerMultiple(functions);
      const result = await executor.execute(
        'return data.processData({ data: [3, 1, 2], processor: "sort" });',
        {},
        {},
      );
      if (JSON.stringify(result.result) !== "[1,2,3]")
        throw new Error("Installed data action failed");
    }
    if (entry.slug === "browser" && args.includes("--render-pdf")) {
      const generate = functions.find((fn) => fn.name === "generatePdf");
      if (!generate) throw new Error("PDF renderer missing");
      const result = z
        .object({ base64: z.string(), sizeBytes: z.number() })
        .parse(
          await generate.handler({
            html: '<html><body><h1>OrgSDK release verification</h1><script>throw new Error("must not run")</script></body></html>',
            options: { filename: "release-verification.pdf" },
          }),
        );
      if (
        !Buffer.from(result.base64, "base64")
          .subarray(0, 5)
          .equals(Buffer.from("%PDF-"))
      )
        throw new Error("Installed PDF renderer failed");
      console.log(
        `Rendered a real PDF from the installed package (${result.sizeBytes} bytes)`,
      );
    }
    results.push({
      slug: entry.slug,
      version: entry.version,
      digest: entry.digest,
      tool_count: functions.length,
      installed: true,
    });
  }
  const report =
    JSON.stringify(
      {
        releases: results,
        tool_count: results.reduce((sum, item) => sum + item.tool_count, 0),
      },
      null,
      2,
    ) + "\n";
  if (option("report")) await writeFile(resolve(option("report")!), report);
  console.log(report);
} finally {
  if (previous === undefined) delete process.env.EXECUTOR_DATA_DIR;
  else process.env.EXECUTOR_DATA_DIR = previous;
  await rm(state, { recursive: true, force: true });
}
