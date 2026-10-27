import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  copyFileSync,
  constants,
  chmodSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { Database } from "bun:sqlite";
import { openStore } from "./db";
import { createApp } from "./app";
import { maintenance } from "./execution";
import { flushOutbox, smtpConfigured } from "./mail";
import { resetPassword } from "./account-cli";

const dataDir = resolve(
  process.env.ORGSDK_DATA_DIR ?? join(homedir(), ".local/share/orgsdk-bun"),
);
const command = process.argv[2] ?? "server";
const port = Number(process.env.PORT ?? "8080");
const hostname = process.env.HOST ?? "127.0.0.1";

function serverLock(): () => void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "server.pid");
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, "utf8"));
    if (!Number.isInteger(pid) || pid < 1)
      throw new Error("Invalid server lock; inspect the data directory.");
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (error: any) {
      if (error.code !== "ESRCH") throw error;
    }
    if (alive)
      throw new Error("An OrgSDK server already owns this data directory.");
    unlinkSync(file);
  }
  writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
  return () => {
    if (existsSync(file) && readFileSync(file, "utf8") === String(process.pid))
      unlinkSync(file);
  };
}

async function main() {
  if (command === "reset-password") {
    if (!process.argv[3]) throw new Error("Usage: orgsdk reset-password EMAIL");
    if (!existsSync(join(dataDir, "orgsdk-bun.sqlite3")))
      throw new Error("No installation found in this data directory.");
    const store = openStore(dataDir);
    try {
      await resetPassword(store, process.argv[3]);
    } finally {
      store.close();
    }
    return;
  }
  if (command === "healthcheck") {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok || (await response.json()).status !== "ok")
      throw new Error("Health check failed.");
    return;
  }
  if (command === "backup") {
    if (!process.argv[3]) throw new Error("Usage: orgsdk backup DESTINATION");
    const destination = resolve(process.argv[3]);
    if (!existsSync(join(dataDir, "orgsdk-bun.sqlite3")))
      throw new Error("No database to back up.");
    if (existsSync(destination))
      throw new Error("Backup destination already exists.");
    const store = openStore(dataDir);
    try {
      store.sqlite.query("VACUUM INTO ?").run(destination);
      chmodSync(destination, 0o600);
      const snapshot = new Database(destination, { readonly: true });
      try {
        const rows = snapshot.query("PRAGMA integrity_check").all() as {
          integrity_check: string;
        }[];
        if (rows.length !== 1 || rows[0]?.integrity_check !== "ok")
          throw new Error("Backup integrity check failed.");
      } finally {
        snapshot.close();
      }
      console.log(
        "Verified SQLite snapshot created. Preserve encryption.key separately.",
      );
    } finally {
      store.close();
    }
    return;
  }
  if (command === "restore") {
    if (!process.argv[3]) throw new Error("Usage: orgsdk restore SOURCE");
    const unlock = serverLock();
    try {
      const destination = join(dataDir, "orgsdk-bun.sqlite3");
      if (existsSync(destination))
        throw new Error("Restore requires an empty installation.");
      const source = resolve(process.argv[3]);
      const snapshot = new Database(source, { readonly: true });
      try {
        const integrity = snapshot.query("PRAGMA integrity_check").get() as {
          integrity_check: string;
        };
        const format = snapshot
          .query("SELECT version FROM orgsdk_format")
          .get() as { version: number };
        if (
          integrity.integrity_check !== "ok" ||
          ![1, 2, 3, 4].includes(format.version)
        )
          throw new Error("Unsupported or invalid backup.");
      } finally {
        snapshot.close();
      }
      if (!existsSync(join(dataDir, "encryption.key")))
        throw new Error(
          "Restore the original encryption.key before restoring the database.",
        );
      copyFileSync(source, destination, constants.COPYFILE_EXCL);
      chmodSync(destination, 0o600);
      console.log("Database restored.");
    } finally {
      unlock();
    }
    return;
  }
  if (command !== "server")
    throw new Error(
      "Usage: orgsdk [server | healthcheck | backup DESTINATION | restore SOURCE | reset-password EMAIL]",
    );
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535.");
  const unlock = serverLock();
  try {
    const store = openStore(dataDir);
    const server = Bun.serve({
      hostname,
      port,
      fetch: createApp(store),
      maxRequestBodySize: 2_000_000,
      idleTimeout: 75,
    });
    let flushing = false;
    const timer = setInterval(() => {
      try {
        maintenance(store);
      } catch {
        console.error("Maintenance failed.");
      }
      if (!flushing && smtpConfigured()) {
        flushing = true;
        void flushOutbox(store)
          .catch(() => console.error("Mail maintenance failed."))
          .finally(() => {
            flushing = false;
          });
      }
    }, 1000);
    const stop = () => {
      clearInterval(timer);
      server.stop(true);
      store.close();
      unlock();
      process.exit(0);
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    console.log(`OrgSDK listening on http://${hostname}:${server.port}`);
  } catch (error) {
    unlock();
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Startup failed.");
  process.exitCode = 1;
});
