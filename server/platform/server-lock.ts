import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
export function serverLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "server.pid");
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, "utf8"));
    if (!Number.isInteger(pid) || pid < 1) {
      throw new Error("Invalid server lock; inspect the data directory.");
    }
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ESRCH"
      ) {
        throw error;
      }
    }
    if (alive) {
      throw new Error("An OrgSDK server already owns this data directory.");
    }
    unlinkSync(file);
  }
  writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
  return () => {
    if (
      existsSync(file) &&
      readFileSync(file, "utf8") === String(process.pid)
    ) {
      unlinkSync(file);
    }
  };
}
