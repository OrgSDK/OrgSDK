import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

function fingerprint(directory: string): string[] {
  return readdirSync(directory, { recursive: true })
    .filter(
      (name): name is string =>
        typeof name === "string" && /\.(json|sql)$/.test(name),
    )
    .map((name) => {
      const hash = createHash("sha256")
        .update(readFileSync(join(directory, name)))
        .digest("hex");
      return `${name}:${hash}`;
    })
    .sort();
}

const temporary = mkdtempSync(join(tmpdir(), "orgsdk-migrations-check-"));
try {
  const output = join(temporary, "migrations");
  cpSync("server/db/migrations", output, { recursive: true });
  const config = join(temporary, "drizzle.config.ts");
  writeFileSync(
    config,
    `import config from ${JSON.stringify(resolve("drizzle.config.ts"))};\nexport default { ...config, out: ${JSON.stringify(relative(process.cwd(), output))} };\n`,
  );
  const before = fingerprint(output);
  for (const command of [
    ["bun", "node_modules/drizzle-kit/bin.cjs", "check"],
    ["bun", "run", "db:generate", "--config", config],
  ]) {
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) {
      throw new Error(`Migration check failed.\n${stdout}\n${stderr}`);
    }
    // Drizzle Kit can log a generation error and still exit with status zero.
    const completed =
      command.at(-1) === "check"
        ? stdout.includes("Everything's fine")
        : stdout.includes("No schema changes") ||
          JSON.stringify(before) !== JSON.stringify(fingerprint(output));
    if (!completed) {
      throw new Error(
        `Migration check did not complete.\n${stdout}\n${stderr}`,
      );
    }
  }
  if (JSON.stringify(before) !== JSON.stringify(fingerprint(output))) {
    throw new Error(
      "Drizzle schema differs from generated migrations. Run bun run db:generate --name <change> and commit the generated files.",
    );
  }
  console.log("Drizzle schema and generated migrations match.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
