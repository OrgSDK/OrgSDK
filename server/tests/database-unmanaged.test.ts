import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../db";
import { dirs } from "./core-fixture";
test("an unmanaged database at the expected filename is refused without modification", () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-core-"));
  dirs.push(dir);
  const path = join(dir, "orgsdk.sqlite3");
  const db = new Database(path);
  db.exec("CREATE TABLE external_records (id INTEGER PRIMARY KEY);");
  db.close();
  const before = readFileSync(path);
  expect(() => openStore(dir)).toThrow("refusing to open");
  expect(readFileSync(path)).toEqual(before);
});
