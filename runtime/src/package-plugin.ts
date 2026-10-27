import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { z } from "zod";
import {
  dependencyNotices,
  embedPluginDependencies,
} from "./package-dependencies";
import { snapshotContext } from "./plugins";

export async function packagePlugin(
  directory: string,
  output: string,
  embeddedDependencies: string[] = [],
  licenseFile?: string,
): Promise<void> {
  const checkout = resolve(directory);
  let root = checkout;
  try {
    await readFile(join(root, ".plugin.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    root = join(checkout, "plugin");
  }
  const manifest = z
    .object({
      name: z.string(),
      version: z.string(),
      entry: z.string().default("index.ts"),
    })
    .passthrough()
    .parse(JSON.parse(await readFile(join(root, ".plugin.json"), "utf8")));
  const entry = resolve(root, manifest.entry);
  if (relative(root, entry).startsWith(".."))
    throw new Error("Plugin entry must be inside its checkout");
  const built = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    format: "esm",
    packages: "bundle",
    minify: true,
    external: embeddedDependencies,
  });
  if (!built.success || built.outputs.length !== 1)
    throw new Error(
      `Plugin build failed: ${built.logs.map(String).join("\n")}`,
    );
  let bytes: Uint8Array = new Uint8Array(await built.outputs[0]!.arrayBuffer());
  if (embeddedDependencies.length)
    bytes = await embedPluginDependencies(
      checkout,
      bytes,
      embeddedDependencies,
    );
  let notices = "";
  if (licenseFile) {
    notices = await readFile(resolve(licenseFile), "utf8");
    const thirdParty = await dependencyNotices(checkout);
    if (thirdParty)
      notices += `\n\nThird-party dependency notices\n\n${thirdParty}`;
    bytes = new TextEncoder().encode(
      `/*!\n${notices.replaceAll("*/", "* /")}\n*/\n${new TextDecoder().decode(bytes)}`,
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const slug = manifest.name
    .replace(/^@[^/]+\//, "")
    .replace(/^orgsdk-plugin-/, "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(slug))
    throw new Error("Invalid plugin slug");
  await mkdir(resolve(output), { recursive: true });
  const bundlePath = join(resolve(output), `${slug}.mjs`);
  await writeFile(bundlePath, bytes);
  if (notices)
    await writeFile(join(resolve(output), `${slug}.notices.txt`), notices);
  const exported = await import(`${bundlePath}?digest=${digest}`);
  const factory = exported.default ?? exported;
  const module =
    typeof factory === "function"
      ? await factory(
          snapshotContext(
            {
              slug,
              version: manifest.version,
              source: "",
              digest,
              credential_id: null,
            },
            undefined,
          ),
        )
      : factory;
  const marketplace = z
    .record(z.string(), z.unknown())
    .parse(manifest.marketplace ?? {});
  let documentation = "";
  for (const candidate of [
    join(root, "docs/overview.md"),
    join(checkout, "README.md"),
    join(root, "README.md"),
  ]) {
    try {
      documentation = await readFile(candidate, "utf8");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const configurationSchema = module.config?.schema
    ? z.toJSONSchema(module.config.schema)
    : { type: "object", additionalProperties: true };
  const catalogEntry = {
    slug,
    version: manifest.version,
    distribution: "external",
    package_url: "",
    digest,
    contract_version: 1,
    display_name: String(marketplace.displayName ?? slug),
    description: String(manifest.description ?? ""),
    category: String(marketplace.category ?? "Other"),
    auth: manifest.auth ?? {},
    marketplace,
    documentation,
    configuration_schema: configurationSchema,
    tools: z
      .array(z.object({ name: z.string() }).passthrough())
      .parse(module.safeFunctions)
      .map(({ handler, ...tool }) => tool),
  };
  await writeFile(
    join(resolve(output), `${slug}.catalog.json`),
    JSON.stringify([catalogEntry], null, 2) + "\n",
  );
  await writeFile(
    join(resolve(output), `${slug}.manifest.json`),
    JSON.stringify(
      {
        slug,
        version: manifest.version,
        source: "",
        distribution: "external",
        package_url: "",
        digest,
        credential_id: null,
        contract_version: 1,
        configuration: {},
        metadata: manifest,
        release_metadata: catalogEntry,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Packaged ${slug}@${manifest.version}; SHA256 ${digest}`);
}
