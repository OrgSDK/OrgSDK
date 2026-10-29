import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../db";
import { dirs } from "./core-fixture";
test("existing SQLite data is never opened as a new installation", () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-core-"));
  dirs.push(dir);
  writeFileSync(join(dir, "db.sqlite3"), "existing data");
  expect(() => openStore(dir)).toThrow("Existing SQLite database");
});
