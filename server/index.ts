import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "./app";
import { resetPassword } from "./cli/accounts";
import { backupDatabase, restoreDatabase } from "./cli/database";
import { openStore } from "./db";
import { databaseFilename } from "./db/migrate";
import { maintenance } from "./execution/maintenance";
import { flushOutbox, smtpConfigured } from "./mail/outbox";

const dataDir = resolve(
  process.env.ORGSDK_DATA_DIR ?? join(homedir(), ".local/share/orgsdk"),
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
    if (!existsSync(join(dataDir, databaseFilename)))
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
    backupDatabase(dataDir, resolve(process.argv[3]));
    console.log(
      "Verified SQLite snapshot created. Preserve encryption.key separately.",
    );
    return;
  }
  if (command === "restore") {
    if (!process.argv[3]) throw new Error("Usage: orgsdk restore SOURCE");
    const unlock = serverLock();
    try {
      restoreDatabase(dataDir, resolve(process.argv[3]));
      console.log("Database restored.");
    } finally {
      unlock();
    }
    return;
  }
  if (command === "migrate") {
    const unlock = serverLock();
    try {
      const store = openStore(dataDir);
      store.close();
      console.log("Database migrations applied.");
    } finally {
      unlock();
    }
    return;
  }
  if (command !== "server")
    throw new Error(
      "Usage: orgsdk [server | migrate | healthcheck | backup DESTINATION | restore SOURCE | reset-password EMAIL]",
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
      void server
        .stop(true)
        .then(() => {
          store.close();
          unlock();
          process.exit(0);
        })
        .catch(() => {
          unlock();
          process.exitCode = 1;
        });
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
