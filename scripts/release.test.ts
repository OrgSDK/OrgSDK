import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkReleasePolicy,
  prepareRelease,
  readRelease,
} from "./release-notes";

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "orgsdk-release-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "runtime"));
  mkdirSync(join(root, "changes"));
  for (const directory of ["", "runtime"]) {
    const manifest = {
      name: directory || "cli",
      version: "0.1.1",
      scripts: { build: "example" },
    };
    writeFileSync(
      join(root, directory, "package.json"),
      JSON.stringify(manifest),
    );
    writeFileSync(
      join(root, directory, "package-lock.json"),
      JSON.stringify({
        version: "0.1.1",
        lockfileVersion: 3,
        packages: {
          "": manifest,
          "node_modules/example": { version: "9.9.9", integrity: "keep-me" },
        },
      }),
    );
  }
  writeFileSync(
    join(root, "CHANGELOG.md"),
    "# Changelog\n\n## 0.1.1\n\nPrevious notes.\n",
  );
  return root;
}

function fragment(root: string, name: string, type = "patch") {
  writeFileSync(
    join(root, "changes", `${name}.json`),
    JSON.stringify({ type, category: "changed", summary: name }),
  );
}

function git(root: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function commit(root: string) {
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
}

function repository(root: string) {
  git(root, "init");
  git(root, "config", "user.email", "fixture@example.test");
  git(root, "config", "user.name", "Fixture");
  commit(root);
  const head = git(root, "rev-parse", "HEAD");
  git(root, "update-ref", "refs/remotes/origin/develop", head);
  git(root, "update-ref", "refs/remotes/origin/main", head);
}

test("plans one highest increment without changing files", () => {
  const root = fixture();
  expect(readRelease(root).nextVersion).toBeNull();
  fragment(root, "fix");
  expect(readRelease(root).nextVersion).toBe("0.1.2");
  fragment(root, "feature", "minor");
  expect(readRelease(root).nextVersion).toBe("0.2.0");
  fragment(root, "breaking", "major");
  expect(readRelease(root).nextVersion).toBe("1.0.0");
  expect(readRelease(root).currentVersion).toBe("0.1.1");
});

test("prepares both packages and locks, retains metadata and history, consumes notes", () => {
  const root = fixture();
  fragment(root, "z-fix");
  fragment(root, "a-feature", "minor");
  expect(prepareRelease(root)).toBe("0.2.0");
  const release = readRelease(root);
  expect(release.currentVersion).toBe("0.2.0");
  expect(release.nextVersion).toBeNull();
  expect(readdirSync(join(root, "changes"))).toEqual([]);
  for (const entry of release.packages) {
    expect(entry.manifest.scripts).toEqual({ build: "example" });
    expect(entry.lock.packages["node_modules/example"]).toEqual({
      version: "9.9.9",
      integrity: "keep-me",
    });
  }
  expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toContain(
    "## 0.2.0\n\n### Changed\n\n- a-feature\n- z-fix\n\n## 0.1.1",
  );
  expect(() => prepareRelease(root)).toThrow("no pending");
});

test("rejects invalid fragments and mismatched locks before editing any package", () => {
  const root = fixture();
  const original = readFileSync(join(root, "package.json"), "utf8");
  fragment(root, "invalid", "surprise");
  expect(() => prepareRelease(root)).toThrow();
  expect(readFileSync(join(root, "package.json"), "utf8")).toBe(original);
  fragment(root, "invalid");
  writeFileSync(
    join(root, "runtime", "package-lock.json"),
    JSON.stringify({
      version: "0.1.0",
      packages: { "": { version: "0.1.1" } },
    }),
  );
  expect(() => prepareRelease(root)).toThrow("must agree");
  expect(readFileSync(join(root, "package.json"), "utf8")).toBe(original);
  expect(readdirSync(join(root, "changes"))).toEqual(["invalid.json"]);
});

test("requires a new fragment on a feature PR, not an existing note", () => {
  const root = fixture();
  fragment(root, "existing");
  repository(root);
  expect(() => checkReleasePolicy(root, "develop", "codex/feature")).toThrow(
    "new changes",
  );
  fragment(root, "new-feature", "minor");
  commit(root);
  expect(() =>
    checkReleasePolicy(root, "develop", "codex/feature"),
  ).not.toThrow();
});

test("accepts prepared releases and rejects incomplete or incorrectly based promotion", () => {
  const root = fixture();
  repository(root);
  expect(() => checkReleasePolicy(root, "main", "codex/feature")).toThrow(
    "from develop",
  );
  expect(() => checkReleasePolicy(root, "main", "develop")).toThrow("increase");
  fragment(root, "feature", "minor");
  prepareRelease(root);
  commit(root);
  expect(() =>
    checkReleasePolicy(root, "develop", "codex/prepare-release"),
  ).not.toThrow();
  expect(() => checkReleasePolicy(root, "main", "develop")).not.toThrow();
  fragment(root, "late-fix");
  expect(() => checkReleasePolicy(root, "main", "develop")).toThrow(
    "unconsumed",
  );
  rmSync(join(root, "changes", "late-fix.json"));
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
  expect(() => checkReleasePolicy(root, "main", "develop")).toThrow(
    "changelog section",
  );
});
