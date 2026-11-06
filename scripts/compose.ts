import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

process.chdir(new URL("../", import.meta.url).pathname);
const compose = [
  "compose",
  "-f",
  process.env.ORGSDK_COMPOSE_FILE ?? "compose.yaml",
];
function run(args: string[], io: "inherit" | "pipe" = "inherit") {
  const child = spawn("docker", [...compose, ...args], { stdio: io });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Docker exited ${code}`)),
    );
  });
  return { child, exited };
}
const command = process.argv[2];
if (command === "start") {
  await run(["up", "-d", "--build", "--wait", "--wait-timeout", "180"]).exited;
  console.log(
    `OrgSDK is ready at http://localhost:${process.env.HTTP_PORT ?? 8080}`,
  );
} else if (command === "backup" || command === "restore") {
  const argument = process.argv[3];
  if (!argument) {
    throw new Error(
      `Usage: npm run container:${command} -- /secure/path/backup.sqlite3`,
    );
  }
  const filename = resolve(argument);
  if (command === "restore") {
    const { child, exited } = run(
      [
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "--entrypoint",
        "/bin/sh",
        "app",
        "-c",
        "set -eu; umask 077; cat > /tmp/orgsdk-restore.sqlite3; exec /usr/local/bin/orgsdk restore /tmp/orgsdk-restore.sqlite3",
      ],
      "pipe",
    );
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    if (!child.stdin) {
      throw new Error("Restore input is unavailable.");
    }
    await Promise.all([
      pipeline(createReadStream(filename), child.stdin),
      exited,
    ]);
    console.log("Database restored.");
  } else {
    const directory = await mkdtemp(join(dirname(filename), ".orgsdk-backup-"));
    const temporary = join(directory, "snapshot.sqlite3");
    const container = `/tmp/orgsdk-backup-${crypto.randomUUID()}.sqlite3`;
    try {
      await run([
        "exec",
        "-T",
        "app",
        "/usr/local/bin/orgsdk",
        "backup",
        container,
      ]).exited;
      const { child, exited } = run(
        ["exec", "-T", "app", "cat", container],
        "pipe",
      );
      child.stdin?.end();
      child.stderr?.pipe(process.stderr);
      if (!child.stdout) {
        throw new Error("Backup output is unavailable.");
      }
      await Promise.all([
        pipeline(
          child.stdout,
          createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
        ),
        exited,
      ]);
      await link(temporary, filename);
      console.log(
        "SQLite snapshot written. Preserve its encryption key and executor data separately.",
      );
    } finally {
      await run(["exec", "-T", "app", "rm", "-f", container]).exited.catch(
        () => undefined,
      );
      await rm(directory, { recursive: true, force: true });
    }
  }
} else {
  throw new Error("Choose start, backup or restore.");
}
