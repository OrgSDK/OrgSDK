import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serverLock } from "../platform/server-lock";
import { temporaryDatabase } from "./database-fixture";

test("only one contender recovers an empty PID file and a killed owner releases its lock", async () => {
  const fixture = temporaryDatabase();
  const pidFile = join(fixture.directory, "server.pid");
  writeFileSync(pidFile, "");
  const contender = () =>
    Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { serverLock } from "./server/platform/server-lock";
         try {
           const unlock = serverLock(process.argv[1]);
           process.once("exit", unlock);
           console.log("acquired");
           setInterval(() => {}, 60_000);
         } catch (error) {
           console.log(error.message);
           process.exitCode = 1;
         }`,
        fixture.directory,
      ],
      { stdout: "pipe", stderr: "inherit" },
    );
  const children = Array.from({ length: 4 }, contender);
  try {
    const messages = await Promise.all(
      children.map(async (child) => {
        const reader = child.stdout.getReader();
        try {
          const { value } = await reader.read();
          return new TextDecoder().decode(value).trim();
        } finally {
          reader.releaseLock();
        }
      }),
    );
    expect(messages.filter((message) => message === "acquired")).toHaveLength(
      1,
    );
    expect(
      messages.filter((message) => message.includes("already owns")),
    ).toHaveLength(3);
    const owner = children[messages.indexOf("acquired")];
    if (!owner) {
      throw new Error("No lock owner reported acquisition");
    }
    expect(readFileSync(pidFile, "utf8")).toBe(String(owner.pid));
    // Even an empty owner record cannot allow a second writer while the owner lives.
    writeFileSync(pidFile, "");
    expect(() => serverLock(fixture.directory)).toThrow("already owns");
    writeFileSync(pidFile, String(owner.pid));
    owner.kill("SIGKILL");
    await owner.exited;
    const unlock = serverLock(fixture.directory);
    try {
      expect(readFileSync(pidFile, "utf8")).toBe(String(process.pid));
    } finally {
      unlock();
    }
    expect(existsSync(pidFile)).toBe(false);
  } finally {
    for (const child of children) {
      child.kill("SIGKILL");
    }
    await Promise.all(children.map((child) => child.exited));
    fixture.cleanup();
  }
});

test("malformed and live legacy records survive refused acquisition", () => {
  const fixture = temporaryDatabase();
  const file = join(fixture.directory, "server.pid");
  try {
    for (const record of ["bad-pid", "-1", "0", String(process.pid)]) {
      writeFileSync(file, record);
      expect(() => serverLock(fixture.directory)).toThrow();
      expect(readFileSync(file, "utf8")).toBe(record);
    }
  } finally {
    fixture.cleanup();
  }
});
