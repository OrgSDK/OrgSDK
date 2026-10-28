import { Database } from "bun:sqlite";
import { count, isNotNull, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ensureEncryptionKey } from "../shared/security";
import {
  assertManagedDatabase,
  databaseFilename,
  migrateDatabase,
} from "./migrate";
import * as schema from "./schema";

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
    const probe = new Database(path, { readonly: true });
    try {
      assertManagedDatabase(probe);
    } finally {
      probe.close();
    }
  }
  const sqlite = new Database(path, { create: true });
  chmodSync(path, 0o600);
  try {
    sqlite.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
    const db = drizzle(sqlite, { schema });
    migrateDatabase(db);
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
    ensureEncryptionKey(dataDir);
    return { db, sqlite, dataDir, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
export type Store = ReturnType<typeof openStore>;
