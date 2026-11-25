import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../db/connection";

export const serverLockGuard = "server.lock";
const owned = "An OrgSDK server already owns this data directory.";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, "ESRCH")) {
      return false;
    }
    throw error;
  }
}

function claimPidFile(file: string) {
  if (existsSync(file)) {
    const record = readFileSync(file, "utf8");
    if (record !== "") {
      const pid = Number(record);
      if (
        !/^\d+$/.test(record.trim()) ||
        !Number.isSafeInteger(pid) ||
        pid < 1
      ) {
        throw new Error("Invalid server lock; inspect the data directory.");
      }
      if (isRunning(pid)) {
        throw new Error(owned);
      }
    }
    unlinkSync(file);
  }
  writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
}

export function serverLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "server.pid");
  // Keep the guard inode for the life of the installation. SQLite's OS lock is
  // released on process death and is independent of the application database.
  const { sqlite } = openDatabase(join(dataDir, serverLockGuard));
  try {
    sqlite.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
    claimPidFile(file);
  } catch (error) {
    sqlite.close();
    if (hasCode(error, "SQLITE_BUSY")) {
      throw new Error(owned);
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    try {
      if (
        existsSync(file) &&
        readFileSync(file, "utf8") === String(process.pid)
      ) {
        unlinkSync(file);
      }
    } finally {
      sqlite.close();
    }
  };
}
