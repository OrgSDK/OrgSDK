import { count, isNotNull, isNull, or } from "drizzle-orm";
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSecretCipher } from "../shared/secrets";
import { ensureEncryptionKey } from "../shared/security";
import {
  assertManagedDatabase,
  databaseFilename,
  migrationsFolder,
} from "./migrate";
import * as schema from "./schema";
import { openDatabase } from "./connection";

export function openStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, databaseFilename);
  if (
    !existsSync(path) &&
    readdirSync(dataDir).some((name) => /\.(sqlite3?|db)$/i.test(name))
  ) {
    throw new Error(
      "Existing SQLite database found; use an empty data directory.",
    );
  }
  if (existsSync(path)) {
    const probe = openDatabase(path, true);
    try {
      assertManagedDatabase(probe.sqlite);
    } finally {
      probe.sqlite.close();
    }
  }
  const connection = openDatabase(path);
  const { sqlite, db } = connection;
  chmodSync(path, 0o600);
  try {
    sqlite.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
    connection.migrate(migrationsFolder);
    if (!existsSync(join(dataDir, "encryption.key"))) {
      const protectedRows = [
        db.select({ count: count() }).from(schema.credentials).get()?.count ??
          0,
        db
          .select({ count: count() })
          .from(schema.users)
          .where(
            or(
              isNotNull(schema.users.totpSecret),
              isNotNull(schema.users.pendingTotpSecret),
            ),
          )
          .get()?.count ?? 0,
        db
          .select({ count: count() })
          .from(schema.mailOutbox)
          .where(isNull(schema.mailOutbox.sentAt))
          .get()?.count ?? 0,
        db.select({ count: count() }).from(schema.oauthAttempts).get()?.count ??
          0,
      ];
      if (protectedRows.some((total) => total > 0)) {
        throw new Error(
          "Encryption key is missing for protected data. Restore the original key.",
        );
      }
    }
    const secrets = createSecretCipher(ensureEncryptionKey(dataDir));
    return { db, sqlite, dataDir, secrets, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
export type Store = ReturnType<typeof openStore>;
