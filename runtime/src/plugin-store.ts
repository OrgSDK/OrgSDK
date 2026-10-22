import { createHash } from "node:crypto";
import {
  mkdir,
  lstat,
  readFile,
  writeFile,
  rename,
  chown,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Plugin } from "./contract";

export function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value))
    throw new Error("Invalid storage identifier");
  return value;
}
export function agentDirectory(agentId: string): string {
  if (process.env.EXECUTOR_AGENT_DIR)
    return resolve(process.env.EXECUTOR_AGENT_DIR);
  return join(
    resolve(process.env.EXECUTOR_DATA_DIR || ".orgsdk"),
    "agents",
    safeSegment(agentId),
  );
}
export async function safeDirectory(directory: string): Promise<void> {
  const parent = resolve(directory, "..");
  if (parent !== directory) await safeDirectory(parent);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Unsafe plugin storage path");
}
function verify(source: Uint8Array, digest: string): void {
  if (createHash("sha256").update(source).digest("hex") !== digest)
    throw new Error("Plugin digest mismatch");
}
const maximumReleaseBytes = 32 * 1024 * 1024;
export async function downloadRelease(url: URL): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(30_000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url.protocol !== "https:")
      throw new Error("Plugin release requires HTTPS");
    const response = await fetch(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location)
        throw new Error("Plugin release redirect missing location");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Plugin release unavailable: ${response.status}`);
    }
    if (Number(response.headers.get("content-length")) > maximumReleaseBytes) {
      await response.body?.cancel();
      throw new Error("Plugin release exceeds size limit");
    }
    if (!response.body) throw new Error("Plugin release has no content");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximumReleaseBytes)
          throw new Error("Plugin release exceeds size limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const source = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      source.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return source;
  }
  throw new Error("Plugin release exceeded redirect limit");
}
export async function installPlugin(
  plugin: Plugin,
  agentId: string,
  localFile?: string,
): Promise<string> {
  safeSegment(agentId);
  safeSegment(plugin.slug);
  if (!/^[a-f0-9]{64}$/.test(plugin.digest))
    throw new Error("Invalid plugin digest");
  const directory = join(
    agentDirectory(agentId),
    "plugins",
    plugin.slug,
    plugin.digest,
  );
  await safeDirectory(directory);
  if (process.getuid?.() === 0) {
    const root = agentDirectory(agentId);
    for (const path of [
      root,
      join(root, "plugins"),
      join(root, "plugins", plugin.slug),
      directory,
    ])
      await chown(path, 1000, 1000);
  }
  const file = join(
    directory,
    plugin.distribution !== "external" ? "plugin.ts" : "plugin.mjs",
  );
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Unsafe plugin module path");
    verify(await readFile(file), plugin.digest);
    if (process.getuid?.() === 0) await chown(file, 1000, 1000);
    return file;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let source: Uint8Array;
  if (localFile) source = await readFile(localFile);
  else if (plugin.distribution !== "external")
    source = new TextEncoder().encode(plugin.source);
  else {
    if (!plugin.package_url)
      throw new Error(
        "Local plugin release not installed; use install --file for this agent",
      );
    const url = new URL(plugin.package_url);
    if (url.protocol !== "https:")
      throw new Error("Plugin release requires an HTTPS package URL");
    source = await downloadRelease(url);
  }
  if (source.byteLength > 32 * 1024 * 1024)
    throw new Error("Plugin release exceeds size limit");
  verify(source, plugin.digest);
  const temporary = join(directory, `${crypto.randomUUID()}.tmp`);
  await writeFile(temporary, source, { flag: "wx", mode: 0o400 });
  await rename(temporary, file);
  if (process.getuid?.() === 0) await chown(file, 1000, 1000);
  return file;
}
