import { constants } from "node:fs";
import { open, mkdir, lstat, rename, unlink, opendir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type { SandboxFunction } from "./engine/sandbox/types";

const MAX_BYTES = 200_000;
const MAX_SCAN = 10_000;
const queues = new Map<string, Promise<unknown>>();
const directoryFlags =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  );
}

function parts(path: unknown, allowEmpty = false): string[] {
  if (
    !validText(path) ||
    path.includes("\0") ||
    path.includes("\\") ||
    Buffer.byteLength(path) > 4096 ||
    isAbsolute(path)
  ) {
    throw new Error("Invalid project file path");
  }
  if (path === "" && allowEmpty) return [];
  const segments = path.split("/");
  if (
    segments.some(
      (part) =>
        !part || part === "." || part === ".." || Buffer.byteLength(part) > 255,
    )
  ) {
    throw new Error("Invalid project file path");
  }
  return segments;
}

function fdPath(handle: FileHandle, name?: string): string {
  return `/proc/self/fd/${handle.fd}${name ? `/${name}` : ""}`;
}

async function directory(
  parent: FileHandle,
  name: string,
  create: boolean,
  signal: AbortSignal,
): Promise<FileHandle> {
  signal.throwIfAborted();
  if (create) {
    try {
      signal.throwIfAborted();
      await mkdir(fdPath(parent, name), { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return open(fdPath(parent, name), directoryFlags);
}

async function walk(
  start: FileHandle,
  segments: string[],
  create: boolean,
  signal: AbortSignal,
): Promise<FileHandle> {
  let current = await open(
    fdPath(start),
    constants.O_RDONLY | constants.O_DIRECTORY,
  );
  try {
    for (const segment of segments) {
      const next = await directory(current, segment, create, signal);
      await current.close();
      current = next;
    }
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

async function workspace(
  root: string,
  signal: AbortSignal,
): Promise<FileHandle> {
  const filesystemRoot = await open("/", directoryFlags);
  try {
    return await walk(filesystemRoot, root.slice(1).split("/"), true, signal);
  } finally {
    await filesystemRoot.close();
  }
}

async function regularFile(
  parent: FileHandle,
  name: string,
  missingAllowed = false,
): Promise<void> {
  try {
    const stat = await lstat(fdPath(parent, name));
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error("Project file must be a regular file with one link");
  } catch (error) {
    if (missingAllowed && (error as NodeJS.ErrnoException).code === "ENOENT")
      return;
    throw error;
  }
}

/**
 * Linux-only fd-anchored text storage. Installed plugins and host execution remain
 * trusted: this SDK does not turn the JavaScript VM into a security boundary.
 * Directory handles avoid pathname ancestor swaps; other host processes remain
 * outside the SDK's serialization and must not mutate this private workspace.
 */
export function projectFileFunctions(
  root: string,
  signal: AbortSignal,
): SandboxFunction[] {
  if (process.platform !== "linux")
    throw new Error("Project files require Linux /proc/self/fd");
  if (!validText(root) || !isAbsolute(root) || root === "/")
    throw new Error("An explicit absolute project workspace root is required");
  parts(root.slice(1));

  function run<T>(operation: (handle: FileHandle) => Promise<T>): Promise<T> {
    const previous = queues.get(root) ?? Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(async () => {
        signal.throwIfAborted();
        const handle = await workspace(root, signal);
        try {
          signal.throwIfAborted();
          return await operation(handle);
        } finally {
          await handle.close();
        }
      });
    queues.set(root, pending);
    void pending
      .finally(() => {
        if (queues.get(root) === pending) queues.delete(root);
      })
      .catch(() => {});
    return pending;
  }

  async function withParent<T>(
    handle: FileHandle,
    path: unknown,
    create: boolean,
    operation: (parent: FileHandle, name: string) => Promise<T>,
  ): Promise<T> {
    const segments = parts(path);
    const name = segments.pop()!;
    const parent = await walk(handle, segments, create, signal);
    try {
      signal.throwIfAborted();
      return await operation(parent, name);
    } finally {
      await parent.close();
    }
  }

  const readFile = (path: string): Promise<string> =>
    run((rootHandle) =>
      withParent(rootHandle, path, false, async (parent, name) => {
        const file = await open(
          fdPath(parent, name),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.nlink !== 1)
            throw new Error(
              "Project file must be a regular file with one link",
            );
          const buffer = Buffer.alloc(MAX_BYTES + 1);
          let size = 0;
          while (size < buffer.length) {
            signal.throwIfAborted();
            const { bytesRead } = await file.read(
              buffer,
              size,
              buffer.length - size,
              null,
            );
            if (!bytesRead) break;
            size += bytesRead;
          }
          if (size > MAX_BYTES)
            throw new Error("Project file exceeds 200000 bytes");
          const content = new TextDecoder("utf-8", { fatal: true }).decode(
            buffer.subarray(0, size),
          );
          if (content.includes("\0"))
            throw new Error(
              "Project file content must be UTF-8 text without NUL",
            );
          return content;
        } finally {
          await file.close();
        }
      }),
    );

  const writeFile = (
    path: string,
    content: string,
  ): Promise<{ path: string; bytes: number }> =>
    run(async (rootHandle) => {
      if (!validText(content) || content.includes("\0"))
        throw new Error("Project file content must be UTF-8 text without NUL");
      const bytes = Buffer.byteLength(content);
      if (bytes > MAX_BYTES)
        throw new Error("Project file exceeds 200000 bytes");
      return withParent(rootHandle, path, true, async (parent, name) => {
        await regularFile(parent, name, true);
        const temporary = `.orgsdk-${randomUUID()}.tmp`;
        signal.throwIfAborted();
        const file = await open(
          fdPath(parent, temporary),
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          signal.throwIfAborted();
          await file.writeFile(content, "utf8");
          await file.sync();
          await regularFile(parent, name, true);
          signal.throwIfAborted();
          await rename(fdPath(parent, temporary), fdPath(parent, name));
          return { path, bytes };
        } finally {
          await file.close();
          await unlink(fdPath(parent, temporary)).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            },
          );
        }
      });
    });

  const listFiles = (path = "", offset = 0, limit = 100) =>
    run(async (rootHandle) => {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw new Error("Invalid listing pagination (limit 1-100)");
      const handle = await walk(rootHandle, parts(path, true), false, signal);
      try {
        const entries: Array<{
          name: string;
          type: "file" | "directory";
          bytes?: number;
        }> = [];
        const iterator = await opendir(fdPath(handle));
        let scanned = 0;
        for await (const entry of iterator) {
          signal.throwIfAborted();
          if (++scanned > MAX_SCAN)
            throw new Error("Project directory exceeds 10000 entries");
          if (!validText(entry.name)) continue;
          const stat = await lstat(fdPath(handle, entry.name));
          if (stat.isDirectory())
            entries.push({ name: entry.name, type: "directory" });
          if (stat.isFile() && stat.nlink === 1)
            entries.push({ name: entry.name, type: "file", bytes: stat.size });
        }
        entries.sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        return {
          entries: entries.slice(offset, offset + limit),
          next_offset: offset + limit < entries.length ? offset + limit : null,
        };
      } finally {
        await handle.close();
      }
    });

  const removeFile = (path: string): Promise<void> =>
    run((rootHandle) =>
      withParent(rootHandle, path, false, async (parent, name) => {
        await regularFile(parent, name);
        signal.throwIfAborted();
        await unlink(fdPath(parent, name));
      }),
    );

  return [
    {
      name: "readFile",
      description:
        "Read a project UTF-8 text file (maximum 200000 bytes; no NUL).",
      handler: readFile,
      calling: "positional",
      returnType: "Promise<string>",
    },
    {
      name: "writeFile",
      description:
        "Atomically persist project UTF-8 text (maximum 200000 bytes; no NUL), creating parent directories.",
      handler: writeFile,
      calling: "positional",
      returnType: "Promise<{path: string; bytes: number}>",
    },
    {
      name: "listFiles",
      description:
        "List sorted project entries. Defaults: root directory, offset 0, limit 100. Limit 1-100; errors above 10000 scanned entries. Symlinks and special files are omitted.",
      handler: listFiles,
      calling: "positional",
      returnType:
        'Promise<{entries: Array<{name: string; type: "file" | "directory"; bytes?: number}>; next_offset: number | null}>',
    },
    {
      name: "removeFile",
      description:
        "Remove one regular project file. Directories, symlinks and hardlinks are refused.",
      handler: removeFile,
      calling: "positional",
      returnType: "Promise<void>",
    },
  ];
}
