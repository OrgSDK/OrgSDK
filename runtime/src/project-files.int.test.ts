import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile, mkdir, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectFileFunctions } from "./project-files";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "orgsdk-files-"));
  roots.push(base);
  return base;
}
function sdk(root: string, signal = new AbortController().signal) {
  return Object.fromEntries(
    projectFileFunctions(root, signal).map((fn) => [fn.name, fn.handler]),
  );
}

test("persistent UTF-8 files survive separate SDK instances and stay isolated", async () => {
  const base = await fixture();
  const root = join(base, "one", "workspace");
  expect(await sdk(root).writeFile("notes/hello.txt", "héllo")).toEqual({
    path: "notes/hello.txt",
    bytes: 6,
  });
  expect(await sdk(root).readFile("notes/hello.txt")).toBe("héllo");
  await expect(
    sdk(join(base, "two", "workspace")).readFile("notes/hello.txt"),
  ).rejects.toThrow();
  await sdk(root).removeFile("notes/hello.txt");
  await expect(sdk(root).readFile("notes/hello.txt")).rejects.toThrow();
  await expect(sdk(root).removeFile("notes")).rejects.toThrow();
});

test("rejects invalid root and hostile paths", async () => {
  for (const root of ["", ".", "/", "/tmp/../workspace", "/tmp/\ud800"])
    expect(() => sdk(root)).toThrow();
  const files = sdk(join(await fixture(), "workspace"));
  for (const path of [
    "../private",
    "/etc/passwd",
    "a/../../private",
    "a\\b",
    "a\0b",
    "a//b",
    ".",
    "a/./b",
    "\ud800",
    "a".repeat(256),
    "a/".repeat(2100),
  ]) {
    await expect(files.writeFile(path, "no")).rejects.toThrow();
  }
});

test("rejects symlink roots, ancestors, final files and hardlinks", async () => {
  const base = await fixture();
  const outside = join(base, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret"), "secret");
  await symlink(outside, join(base, "alias"));
  await expect(
    sdk(join(base, "alias", "workspace")).writeFile("secret", "bad"),
  ).rejects.toThrow();
  await expect(sdk(join(base, "alias")).readFile("secret")).rejects.toThrow();
  const root = join(base, "workspace");
  await mkdir(root);
  await symlink(outside, join(root, "nested"));
  await symlink(join(outside, "secret"), join(root, "final"));
  await link(join(outside, "secret"), join(root, "hard"));
  const files = sdk(root);
  for (const path of ["nested/secret", "final", "hard"]) {
    await expect(files.readFile(path)).rejects.toThrow();
    await expect(files.writeFile(path, "bad")).rejects.toThrow();
    await expect(files.removeFile(path)).rejects.toThrow();
  }
  expect((await files.listFiles()).entries).toEqual([]);
});

test("bounds reads and writes by UTF-8 bytes and rejects malformed text", async () => {
  const root = join(await fixture(), "workspace");
  const files = sdk(root);
  await files.writeFile("max", "é".repeat(100_000));
  expect((await files.readFile("max")).length).toBe(100_000);
  for (const text of ["é".repeat(100_001), "\ud800", "a\0b"])
    await expect(files.writeFile("max", text)).rejects.toThrow();
  expect((await files.readFile("max")).length).toBe(100_000);
  await writeFile(join(root, "big"), Buffer.alloc(200_001, 65));
  await writeFile(join(root, "invalid"), Buffer.from([0xc3, 0x28]));
  await writeFile(join(root, "binary"), Buffer.from([0]));
  for (const name of ["big", "invalid", "binary"])
    await expect(files.readFile(name)).rejects.toThrow();
});

test("lists sorted bounded pages and validates pagination", async () => {
  const files = sdk(join(await fixture(), "workspace"));
  for (const name of ["c", "a", "b"]) await files.writeFile(name, name);
  expect(await files.listFiles("", 0, 2)).toEqual({
    entries: [
      { name: "a", type: "file", bytes: 1 },
      { name: "b", type: "file", bytes: 1 },
    ],
    next_offset: 2,
  });
  expect(await files.listFiles("", 2, 2)).toEqual({
    entries: [{ name: "c", type: "file", bytes: 1 }],
    next_offset: null,
  });
  for (const [offset, limit] of [
    [-1, 10],
    [0, 101],
    [0, 0],
    [NaN, 10],
    [0, Infinity],
  ])
    await expect(files.listFiles("", offset, limit)).rejects.toThrow();
});

test("abort cancels queued mutations before creating files", async () => {
  const root = join(await fixture(), "workspace");
  const controller = new AbortController();
  const files = sdk(root, controller.signal);
  const pending = files.writeFile("cancelled", "text");
  controller.abort();
  await expect(pending).rejects.toThrow();
  for (const name of ["readFile", "writeFile", "listFiles", "removeFile"])
    await expect(files[name]("file", "text")).rejects.toThrow();
  await expect(sdk(root).readFile("cancelled")).rejects.toThrow();
});

test("large directories fail explicitly instead of returning incomplete pages", async () => {
  const root = join(await fixture(), "workspace");
  await mkdir(root);
  for (let start = 0; start < 10_001; start += 100) {
    await Promise.all(
      Array.from({ length: Math.min(100, 10_001 - start) }, (_, index) =>
        writeFile(join(root, `entry-${start + index}`), ""),
      ),
    );
  }
  await expect(sdk(root).listFiles()).rejects.toThrow("exceeds 10000 entries");
});
