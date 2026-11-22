import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const [mode, directory, version, source, selected] = process.argv.slice(2);
assert(mode === "verify" || mode === "publish");
assert(directory && version && source);
assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
assert.match(source, /^[a-f0-9]{40}$/);

const manifest = JSON.parse(
  readFileSync(join(directory, "release-artifacts.json"), "utf8"),
) as {
  version: string;
  source: string;
  packages: Record<string, { filename: string; integrity: string }>;
};
assert.equal(manifest.version, version);
assert.equal(manifest.source, source);

async function registryVersion(name: string, selector: string) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${selector}`,
  );
  if (response.status === 404) {
    return undefined;
  }
  assert(response.ok, `npm lookup for ${name}@${selector}: ${response.status}`);
  return (await response.json()) as {
    version: string;
    dist: { integrity: string };
  };
}

const packages = mode === "verify" ? ["cli", "executor"] : [selected];
for (const suffix of packages) {
  assert(suffix === "cli" || suffix === "executor");
  const name = `@orgsdk/${suffix}`;
  const filename: string = `orgsdk-${suffix}-${version}.tgz`;
  const archive = resolve(directory, filename);
  const integrity =
    "sha512-" +
    createHash("sha512").update(readFileSync(archive)).digest("base64");
  assert.equal(manifest.packages[name]?.filename, filename);
  assert.equal(manifest.packages[name]?.integrity, integrity);
  const pkg = JSON.parse(
    execFileSync("tar", ["-xOzf", archive, "package/package.json"], {
      encoding: "utf8",
    }),
  ) as { name: string; version: string };
  assert.equal(pkg.name, name);
  assert.equal(pkg.version, version);
  if (mode === "verify") {
    continue;
  }

  const existing = await registryVersion(name, version);
  if (existing) {
    assert.equal(
      existing.dist.integrity,
      integrity,
      `Different bytes already published for ${name}@${version}`,
    );
    console.log(
      `${name}@${version} is already published with the release integrity.`,
    );
    continue;
  }

  const latest = await registryVersion(name, "latest");
  if (latest) {
    // Both release lines use stable major.minor.patch versions.
    const newestFirst = [version, latest.version].sort((a, b) =>
      b.localeCompare(a, "en", { numeric: true }),
    );
    assert.equal(
      newestFirst[0],
      version,
      `Refusing to move ${name}@latest backwards`,
    );
  }
  execFileSync(
    "npm",
    [
      "publish",
      archive,
      "--registry=https://registry.npmjs.org/",
      "--access=public",
      "--tag=latest",
      "--provenance",
      "--ignore-scripts",
    ],
    { stdio: "inherit" },
  );
  for (let attempt = 0; attempt < 6; attempt++) {
    const published = await registryVersion(name, version);
    if (published) {
      assert.equal(published.dist.integrity, integrity);
      break;
    }
    assert(
      attempt < 5,
      `npm did not return ${name}@${version} after publication`,
    );
    await sleep(3000);
  }
}
