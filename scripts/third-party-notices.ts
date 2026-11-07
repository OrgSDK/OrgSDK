import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

const packages = [
  "node_modules/@modelcontextprotocol/client",
  "node_modules/@modelcontextprotocol/core",
  "frontend/node_modules/monaco-editor",
  "frontend/node_modules/zod",
];
const packageSchema = z.object({ name: z.string(), version: z.string() });

export async function writeThirdPartyNotices() {
  const root = new URL("../", import.meta.url);
  const licenses = new Map<string, string[]>();
  for (const directory of packages) {
    const manifest = packageSchema.parse(
      JSON.parse(
        await readFile(new URL(`${directory}/package.json`, root), "utf8"),
      ),
    );
    const license = await readFile(
      new URL(`${directory}/LICENSE`, root),
      "utf8",
    );
    if (!license.trim()) {
      throw new Error(`Missing license text for ${manifest.name}`);
    }
    const names = licenses.get(license) ?? [];
    names.push(`${manifest.name}@${manifest.version}`);
    licenses.set(license, names);
  }
  const sections = [...licenses].map(
    ([license, names]) =>
      `${"=".repeat(78)}\n${names.join("\n")}\n\n${license}`,
  );
  const header = [
    "OrgSDK third-party notices",
    "Generated from installed, lockfile-resolved dependencies during the release build.",
    "These notices cover the listed redistributed components. Other dependencies",
    "retain their own notices; OrgSDK's license is supplied separately.",
  ].join("\n");
  const output = new URL("dist/", root);
  await mkdir(output, { recursive: true });
  await writeFile(
    new URL("THIRD_PARTY_NOTICES.txt", output),
    `${header}\n\n${sections.join("\n\n")}\n`,
  );
}
