import { expect, test } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the migration gate rejects a schema change without generated migrations", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "orgsdk-schema-drift-"));
  try {
    for (const file of [
      "server/db",
      "scripts/check-migrations.ts",
      "drizzle.config.ts",
      "package.json",
    ]) {
      cpSync(file, join(temporary, file), { recursive: true });
    }
    symlinkSync(
      resolve("node_modules"),
      join(temporary, "node_modules"),
      "dir",
    );
    const schema = join(temporary, "server/db/schema.ts");
    writeFileSync(
      schema,
      `${readFileSync(schema, "utf8")}\nimport { integer, sqliteTable } from "drizzle-orm/sqlite-core";\nexport const migrationProbe = sqliteTable("migration_probe", { id: integer("id").primaryKey() });\n`,
    );
    const child = Bun.spawn(["bun", "scripts/check-migrations.ts"], {
      cwd: temporary,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(status, stdout).not.toBe(0);
    expect(stderr).toContain(
      "Drizzle schema differs from generated migrations",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 20000);
