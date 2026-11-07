import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const manifestSchema = z
  .object({ version: z.string().regex(versionPattern) })
  .passthrough();
const lockSchema = manifestSchema.extend({
  packages: z.object({ "": manifestSchema }).catchall(z.unknown()),
});
const fragmentSchema = z.strictObject({
  type: z.enum(["patch", "minor", "major"]),
  category: z.enum(["added", "changed", "fixed"]),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !/[\r\n]/.test(value), "Use one line"),
});
const packageDirectories = ["", "runtime"];
const categories = { added: "Added", changed: "Changed", fixed: "Fixed" };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readRelease(root: string) {
  const packages = packageDirectories.map((directory) => ({
    directory,
    manifest: manifestSchema.parse(
      readJson(join(root, directory, "package.json")),
    ),
    lock: lockSchema.parse(
      readJson(join(root, directory, "package-lock.json")),
    ),
  }));
  const currentVersion = packages[0]?.manifest.version;
  if (!currentVersion) {
    throw new Error("Missing platform package version");
  }
  for (const { directory, manifest, lock } of packages) {
    if (
      [manifest.version, lock.version, lock.packages[""].version].some(
        (version) => version !== currentVersion,
      )
    ) {
      throw new Error(
        `Package and lockfile versions must agree: ${directory || "root"}`,
      );
    }
  }
  const fragments = readdirSync(join(root, "changes"))
    .sort()
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      name,
      ...fragmentSchema.parse(readJson(join(root, "changes", name))),
    }));
  const bump = fragments.some((fragment) => fragment.type === "major")
    ? 0
    : fragments.some((fragment) => fragment.type === "minor")
      ? 1
      : 2;
  const numbers = currentVersion.split(".").map(Number);
  if (!numbers.every(Number.isSafeInteger)) {
    throw new Error("Version components must be safe integers");
  }
  const component = numbers[bump];
  if (component === undefined || !Number.isSafeInteger(component + 1)) {
    throw new Error("Cannot increment this version component");
  }
  numbers[bump] = component + 1;
  for (let index = bump + 1; index < numbers.length; index += 1) {
    numbers[index] = 0;
  }
  const nextVersion = fragments.length ? numbers.join(".") : null;
  return { packages, currentVersion, nextVersion, fragments };
}

function git(root: string, args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function checkReleasePolicy(root: string, base: string, head: string) {
  if (!["main", "develop"].includes(base)) {
    return;
  }
  const release = readRelease(root);
  const previous = manifestSchema.parse(
    JSON.parse(git(root, ["show", `origin/${base}:package.json`])),
  );
  const versionChanged = previous.version !== release.currentVersion;
  if (base === "main" && head !== "develop") {
    throw new Error("Release PRs to main must come from develop");
  }
  if (base === "main" || versionChanged) {
    const before = previous.version.split(".").map(Number);
    const after = release.currentVersion.split(".").map(Number);
    const firstDifference = after.findIndex(
      (part, index) => part !== before[index],
    );
    const newComponent = after[firstDifference];
    const oldComponent = before[firstDifference];
    if (
      newComponent === undefined ||
      oldComponent === undefined ||
      newComponent <= oldComponent
    ) {
      throw new Error("A release must increase the package version");
    }
    if (release.fragments.length) {
      throw new Error(
        "Prepare the release before merging: unconsumed changelog fragments remain",
      );
    }
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    if (!changelog.split("\n").includes(`## ${release.currentVersion}`)) {
      throw new Error("The release version must have a changelog section");
    }
    return;
  }
  const added = git(root, [
    "diff",
    "--name-only",
    "--diff-filter=A",
    `origin/${base}...HEAD`,
    "--",
    "changes/",
  ]).split("\n");
  if (
    !release.fragments.some((fragment) =>
      added.includes(`changes/${fragment.name}`),
    )
  ) {
    throw new Error("Each PR to develop needs a new changes/*.json fragment");
  }
}

export function prepareRelease(root: string) {
  const release = readRelease(root);
  if (!release.nextVersion) {
    throw new Error("There are no pending changelog fragments");
  }
  const changelogPath = join(root, "CHANGELOG.md");
  const existing = existsSync(changelogPath)
    ? readFileSync(changelogPath, "utf8")
    : "# Changelog\n";
  if (
    !existing.startsWith("# Changelog\n") ||
    existing.split("\n").includes(`## ${release.nextVersion}`)
  ) {
    throw new Error(
      "Changelog has an invalid heading or already contains this release",
    );
  }
  const notes = Object.entries(categories).flatMap(([category, heading]) => {
    const entries = release.fragments.filter(
      (fragment) => fragment.category === category,
    );
    return entries.length
      ? [
          `### ${heading}\n\n${entries.map((fragment) => `- ${fragment.summary}`).join("\n")}`,
        ]
      : [];
  });
  const changelog = `# Changelog\n\n## ${release.nextVersion}\n\n${notes.join("\n\n")}\n\n${existing.slice("# Changelog\n".length).trim()}\n`;
  // Parse and validate every input before making the reviewable local edits.
  for (const { directory, manifest, lock } of release.packages) {
    manifest.version = release.nextVersion;
    lock.version = release.nextVersion;
    lock.packages[""].version = release.nextVersion;
    writeFileSync(
      join(root, directory, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    writeFileSync(
      join(root, directory, "package-lock.json"),
      `${JSON.stringify(lock, null, 2)}\n`,
    );
  }
  writeFileSync(changelogPath, changelog);
  for (const fragment of release.fragments) {
    unlinkSync(join(root, "changes", fragment.name));
  }
  return release.nextVersion;
}
