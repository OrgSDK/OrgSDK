import { checkHealth } from "./platform/health";
import {
  installationPorts,
  listenOnInstallationPort,
  rememberPort,
} from "./platform/listen";
import { studioAudience } from "./auth/studio";
import { existsSync } from "node:fs";
import { serverLock } from "./platform/server-lock";
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

const hostname = process.env.HOST ?? "127.0.0.1";

async function main() {
  if (command === "reset-password") {
    if (!process.argv[3]) {
      throw new Error("Usage: orgsdk reset-password EMAIL");
    }
    if (!existsSync(join(dataDir, databaseFilename))) {
      throw new Error("No installation found in this data directory.");
    }
    const store = openStore(dataDir);
    try {
      await resetPassword(store, process.argv[3]);
    } finally {
      store.close();
    }
    return;
  }
  if (command === "healthcheck") {
    const [port = 8080] = installationPorts(dataDir, hostname);
    await checkHealth(hostname, port);
    return;
  }
  if (command === "backup") {
    if (!process.argv[3]) {
      throw new Error("Usage: orgsdk backup DESTINATION");
    }
    backupDatabase(dataDir, resolve(process.argv[3]));
    console.log(
      "Verified SQLite snapshot created. Preserve encryption.key separately.",
    );
    return;
  }
  if (command === "restore") {
    if (!process.argv[3]) {
      throw new Error("Usage: orgsdk restore SOURCE");
    }
    const unlock = serverLock(dataDir);
    try {
      restoreDatabase(dataDir, resolve(process.argv[3]));
      console.log("Database restored.");
    } finally {
      unlock();
    }
    return;
  }
  if (command === "migrate") {
    const unlock = serverLock(dataDir);
    try {
      const store = openStore(dataDir);
      store.close();
      console.log("Database migrations applied.");
    } finally {
      unlock();
    }
    return;
  }
  if (command !== "server") {
    throw new Error(
      "Usage: orgsdk [server | migrate | healthcheck | backup DESTINATION | restore SOURCE | reset-password EMAIL]",
    );
  }
  const ports = installationPorts(dataDir, hostname);
  const unlock = serverLock(dataDir);
  try {
    let handle: ReturnType<typeof createApp> | undefined;
    const server = await listenOnInstallationPort(ports, {
      hostname,
      fetch: (request) =>
        handle
          ? handle(request)
          : Promise.resolve(new Response("Starting OrgSDK", { status: 503 })),
    });
    const store = await (async () => {
      try {
        rememberPort(dataDir, server.port);
        return openStore(dataDir);
      } catch (error) {
        await server.stop(true);
        throw error;
      }
    })();
    handle = createApp(store);
    if (process.send && process.connected) {
      try {
        await checkHealth(hostname, server.port);
      } catch (error) {
        store.close();
        await server.stop(true);
        throw error;
      }
    }
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
    const host = hostname.includes(":") ? "[" + hostname + "]" : hostname;
    const endpoint =
      process.env.ORGSDK_PUBLIC_ORIGIN ??
      "http://" + host + ":" + String(server.port);
    console.log("OrgSDK listening on " + endpoint);
    const audience = studioAudience(endpoint);
    if (audience) {
      console.log(
        "Open dashboard: " +
          audience +
          "/?server=" +
          encodeURIComponent(endpoint),
      );
    }
    process.send?.({ port: server.port });
  } catch (error) {
    unlock();
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Startup failed.");
  process.exitCode = 1;
});
