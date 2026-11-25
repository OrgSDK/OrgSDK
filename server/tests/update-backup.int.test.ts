import assert from "node:assert/strict";
import { test, expect } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { installSelectedRelease } from "../../scripts/installation-updater";
import { openStore } from "../db";
import { seedWorkspace } from "./database-fixture";

test("the updater keeps a recoverable installation and changes the selected version only after npm and version checks succeed", async () => {
  const root = await mkdtemp(join(tmpdir(), "orgsdk-update-backup-"));
  const data = join(root, "data");
  const storage = join(root, "releases");
  const npm = join(root, "npm");
  const manager = { storage, npm };
  const target = "2.2.0";
  const apply = () =>
    installSelectedRelease(
      manager,
      data,
      resolve("server/index.ts"),
      "2.1.0",
      target,
    );
  try {
    await mkdir(storage);
    const store = openStore(data);
    seedWorkspace(store);
    store.close();
    const key = await readFile(join(data, "encryption.key"));
    await mkdir(join(data, "executor"));
    await writeFile(join(data, "executor", "project-proof"), "preserved");
    await writeFile(join(storage, "active-version"), "2.1.0\n");
    await writeFile(npm, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    await assert.rejects(apply, /Command failed/);
    expect(await readFile(join(storage, "active-version"), "utf8")).toBe(
      "2.1.0\n",
    );

    const backup = (await readdir(storage)).find((name) =>
      name.startsWith("backup-"),
    );
    expect(backup).toBeDefined();
    if (!backup) {
      throw new Error("No backup directory");
    }
    const copied = join(storage, backup);
    expect((await stat(copied)).mode & 0o077).toBe(0);
    expect(await readFile(join(copied, "encryption.key"))).toEqual(key);
    expect(
      await readFile(join(copied, "executor", "project-proof"), "utf8"),
    ).toBe("preserved");
    expect(await readdir(copied)).not.toContain("server.lock");
    const restored = openStore(copied);
    try {
      expect(
        restored.sqlite.query("SELECT name FROM workspaces").get(),
      ).toEqual({ name: "Workspace" });
    } finally {
      restored.close();
    }
    await writeFile(
      npm,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.at(-1) !== "@orgsdk/cli@2.2.0") process.exit(2);
const bin = path.join(args[args.indexOf("--prefix")+1],"node_modules/@orgsdk/cli/bin");
fs.mkdirSync(bin,{recursive:true});
fs.writeFileSync(path.join(bin,"orgsdk.mjs"),'console.log("2.2.0");');
`,
    );
    const selected = await apply();
    expect((await stat(selected)).isFile()).toBe(true);
    expect(await readFile(join(storage, "active-version"), "utf8")).toBe(
      target + "\n",
    );
    expect(await readdir(data)).not.toContain("server.pid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
