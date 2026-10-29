import { Database } from "bun:sqlite";
import { chmodSync, constants, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertManagedDatabase, databaseFilename } from "../db/migrate";

function verifySnapshot(sqlite: Database): void {
  const integrity = sqlite
    .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
    .all();
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    throw new Error("Backup integrity check failed.");
  }
  assertManagedDatabase(sqlite);
  if (!sqlite.query("SELECT hash FROM __drizzle_migrations LIMIT 1").get()) {
    throw new Error("Backup has no applied migrations.");
  }
  if (sqlite.query("PRAGMA foreign_key_check").get()) {
    throw new Error("Backup contains invalid foreign keys.");
  }
}

export function backupDatabase(dataDir: string, destination: string): void {
  if (!existsSync(join(dataDir, databaseFilename))) {
    throw new Error("No database to back up.");
  }
  if (existsSync(destination)) {
    throw new Error("Backup destination already exists.");
  }
  const source = new Database(join(dataDir, databaseFilename), {
    readonly: true,
  });
  try {
    verifySnapshot(source);
    source.query("VACUUM INTO ?").run(destination);
    chmodSync(destination, 0o600);
    const snapshot = new Database(destination, { readonly: true });
    try {
      verifySnapshot(snapshot);
    } finally {
      snapshot.close();
    }
  } finally {
    source.close();
  }
}

export function restoreDatabase(dataDir: string, source: string): void {
  const destination = join(dataDir, databaseFilename);
  if (existsSync(destination)) {
    throw new Error("Restore requires an empty installation.");
  }
  const snapshot = new Database(source, { readonly: true });
  try {
    verifySnapshot(snapshot);
  } finally {
    snapshot.close();
  }
  if (!existsSync(join(dataDir, "encryption.key"))) {
    throw new Error(
      "Restore the original encryption.key before restoring the database.",
    );
  }
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  chmodSync(destination, 0o600);
}
