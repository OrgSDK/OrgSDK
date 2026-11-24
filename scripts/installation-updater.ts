import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { newerStable, stableVersion } from "../server/platform/stable-release";
import { serverLock } from "../server/platform/server-lock";

const run = promisify(execFile);
const versionFile = "active-version";
const packageDirectory = "node_modules/@orgsdk/cli";
const packageEntry = "bin/orgsdk.mjs";

async function installationStorage(data: string) {
  const directory = await realpath(data);
  const key = createHash("sha256").update(directory).digest("hex");
  const storage = join(homedir(), ".local/share/orgsdk-updates", key);
  if (
    storage === directory ||
    storage.startsWith(directory + sep) ||
    directory === sep
  ) {
    return;
  }
  return storage;
}

export async function selectedCli(
  data: string,
  installed: string,
): Promise<string | undefined> {
  if (process.getuid?.() === 0) {
    return;
  }
  let storage: string;
  let active: string;
  try {
    const directory = await installationStorage(data);
    if (!directory) {
      return;
    }
    storage = directory;
    active = (await readFile(join(storage, versionFile), "utf8")).trim();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  stableVersion.parse(active);
  if (newerStable(active, installed)) {
    return join(storage, active, packageDirectory, packageEntry);
  }
}

export async function updateManager(
  data: string,
  host: string,
  executorData: string,
  mode: string,
  cli: string,
) {
  if (
    process.getuid?.() === 0 ||
    process.versions.bun ||
    existsSync("/.dockerenv") ||
    existsSync("/run/.containerenv") ||
    !["localhost", "127.0.0.1", "::1"].includes(host) ||
    mode !== "host" ||
    resolve(executorData) !== join(data, "executor") ||
    !cli.endsWith("/" + packageDirectory + "/" + packageEntry) ||
    process.env.ORGSDK_PUBLIC_ORIGIN ||
    process.env.ORGSDK_DISABLE_UPDATES === "1"
  ) {
    return;
  }
  // Resolve the executable before changing the working directory for npm.
  for (const directory of (process.env.PATH ?? "")
    .split(delimiter)
    .filter((path) => path.startsWith("/"))) {
    const npm = join(directory, "npm");
    try {
      await access(npm, constants.X_OK);
    } catch {
      continue;
    }
    try {
      const storage = await installationStorage(data);
      if (!storage) {
        return;
      }
      await mkdir(storage, { recursive: true, mode: 0o700 });
      const info = await lstat(storage);
      if (
        !info.isDirectory() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o077) !== 0
      ) {
        return;
      }
      await access(storage, constants.W_OK);
      return { storage, npm };
    } catch {
      return;
    }
  }
}

async function preserveInstallation(
  data: string,
  storage: string,
  server: string,
) {
  const backup = await mkdtemp(join(storage, "backup-"));
  console.log("Saving installation backup in " + backup);
  // Only the stopped server's SQLite snapshot is authoritative, including any outstanding WAL.
  await run(
    process.execPath,
    [server, "backup", join(backup, "orgsdk.sqlite3")],
    { env: { ...process.env, ORGSDK_DATA_DIR: data } },
  );
  for (const name of await readdir(data)) {
    if (
      [
        "server.pid",
        "orgsdk.sqlite3",
        "orgsdk.sqlite3-wal",
        "orgsdk.sqlite3-shm",
        "orgsdk.sqlite3-journal",
      ].includes(name)
    ) {
      continue;
    }
    await cp(join(data, name), join(backup, name), {
      recursive: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
  }
  await access(join(backup, "encryption.key"));
  return backup;
}

export async function installSelectedRelease(
  manager: { storage: string; npm: string },
  data: string,
  server: string,
  installed: string,
  target: string,
) {
  if (!newerStable(target, installed)) {
    throw new Error("Select a newer stable release.");
  }
  const unlock = serverLock(data);
  try {
    const { storage, npm } = manager;
    for (const name of ["encryption.key", "executor"]) {
      const info = await lstat(join(data, name)).catch((error: unknown) => {
        if (
          name === "executor" &&
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      });
      if (info?.isSymbolicLink()) {
        throw new Error(
          "Back up externally linked installation data before updating manually.",
        );
      }
    }
    await preserveInstallation(data, storage, server);
    const staging = await mkdtemp(join(storage, "download-"));
    const destination = join(storage, target);
    try {
      console.log("Installing OrgSDK " + target);
      await run(
        npm,
        [
          "install",
          "--global=false",
          "--prefix",
          staging,
          "--registry=https://registry.npmjs.org/",
          "--@orgsdk:registry=https://registry.npmjs.org/",
          "--engine-strict",
          "--no-audit",
          "--no-fund",
          "--no-save",
          "@orgsdk/cli@" + target,
        ],
        { cwd: staging, timeout: 600_000 },
      );
      const cli = join(staging, packageDirectory, packageEntry);
      for (const args of [["--version"], ["executor", "--version"]]) {
        const { stdout } = await run(process.execPath, [cli, ...args], {
          env: { ...process.env, ORGSDK_DATA_DIR: staging },
          timeout: 15_000,
        });
        if (stdout.trim() !== target) {
          throw new Error("Downloaded package version mismatch.");
        }
      }
      // A terminated attempt may have staged this same target without selecting it.
      try {
        await rename(staging, destination);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          ["ENOTEMPTY", "EEXIST"].includes(String(error.code))
        )) {
          throw error;
        }
        const manifest = z.object({
          name: z.literal("@orgsdk/cli"),
          version: z.literal(target),
        });
        manifest.parse(
          JSON.parse(
            await readFile(
              join(destination, packageDirectory, "package.json"),
              "utf8",
            ),
          ),
        );
        await stat(join(destination, packageDirectory, packageEntry));
      }
      const marker = join(storage, "selection-" + randomUUID());
      await writeFile(marker, target + "\n", { mode: 0o600, flag: "wx" });
      await rename(marker, join(storage, versionFile));
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return join(destination, packageDirectory, packageEntry);
  } finally {
    unlock();
  }
}
