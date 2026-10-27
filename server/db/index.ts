import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";
import { coreDDL } from "./core";
import { domainDDL } from "./domain";
import { oauthDDL } from "./oauth";
import { ensureEncryptionKey } from "../security";

export function openStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "orgsdk-bun.sqlite3");
  if (
    !existsSync(path) &&
    readdirSync(dataDir).some((name) => /\.(sqlite3?|db)$/i.test(name))
  )
    throw new Error(
      "Existing SQLite database found; use a new data directory for the Bun format.",
    );
  if (existsSync(path)) {
    const probe = new Database(path, { readonly: true });
    try {
      const marker = probe
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='orgsdk_format'",
        )
        .get();
      if (!marker)
        throw new Error(
          "Unrecognized or Django database; refusing to open it.",
        );
      const version = probe
        .query("SELECT version FROM orgsdk_format")
        .get() as { version: number } | null;
      if (![1, 2, 3, 4].includes(version?.version ?? 0))
        throw new Error("Unsupported OrgSDK database format.");
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
    const tables = sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];
    if (tables.length && !tables.some((t) => t.name === "orgsdk_format"))
      throw new Error("Unrecognized or Django database; refusing to open it.");
    if (!tables.length)
      sqlite
        .transaction(() => {
          sqlite.exec(
            "CREATE TABLE orgsdk_format (version INTEGER NOT NULL); INSERT INTO orgsdk_format VALUES (4);",
          );
          sqlite.exec(coreDDL);
          sqlite.exec(domainDDL);
          sqlite.exec(oauthDDL);
        })
        .immediate();
    const version = sqlite.query("SELECT version FROM orgsdk_format").get() as {
      version: number;
    } | null;
    if (version?.version === 1)
      sqlite
        .transaction(() => {
          sqlite.exec(`CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS mail_outbox (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL, lease_until INTEGER, sent_at INTEGER, last_error TEXT);
        ALTER TABLE users ADD COLUMN totp_last_counter INTEGER;
        UPDATE orgsdk_format SET version=3;`);
        })
        .immediate();
    else if (version?.version === 2)
      sqlite
        .transaction(() => {
          sqlite.exec(
            "ALTER TABLE users ADD COLUMN totp_last_counter INTEGER; UPDATE orgsdk_format SET version=3;",
          );
        })
        .immediate();
    else if (version?.version !== 3 && version?.version !== 4)
      throw new Error("Unsupported OrgSDK database format.");
    if (version && version.version < 4)
      sqlite
        .transaction(() => {
          sqlite.exec(oauthDDL);
          sqlite.exec("UPDATE orgsdk_format SET version=4;");
        })
        .immediate();
    if (!existsSync(join(dataDir, "encryption.key"))) {
      const protectedRows = sqlite
        .query(
          `SELECT (SELECT count(*) FROM domain_credentials) + (SELECT count(*) FROM users WHERE totp_secret IS NOT NULL OR pending_totp_secret IS NOT NULL) + (SELECT count(*) FROM mail_outbox WHERE sent_at IS NULL) + (SELECT count(*) FROM oauth_attempts) AS count`,
        )
        .get() as { count: number };
      if (protectedRows.count)
        throw new Error(
          "Encryption key is missing for protected data. Restore the original key.",
        );
    }
    ensureEncryptionKey(dataDir);
    return {
      db: drizzle(sqlite, { schema }),
      sqlite,
      dataDir,
      close: () => sqlite.close(),
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
export type Store = ReturnType<typeof openStore>;
