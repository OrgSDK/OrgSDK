import { createHash } from "node:crypto";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

async function ensureDirectory(path) {
  const parent = dirname(path);
  if (parent !== path) await ensureDirectory(parent);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Unsafe embedded plugin dependency directory");
}

export async function loadEmbeddedPlugin(encoded, moduleUrl) {
  const digest = createHash("sha256").update(encoded).digest("hex");
  const root = fileURLToPath(new URL(`./.embedded/${digest}/`, moduleUrl));
  const files = JSON.parse(
    gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"),
  );
  for (const [relativePath, content, expectedDigest] of files) {
    const parts = relativePath.split("/");
    if (
      parts.some(
        (part) => !part || part === "." || part === ".." || part.includes("\\"),
      )
    )
      throw new Error("Unsafe embedded plugin dependency path");
    const path = join(root, ...parts);
    await ensureDirectory(dirname(path));
    try {
      await writeFile(path, Buffer.from(content, "base64"), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Unsafe embedded plugin dependency file");
    if (
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex") !== expectedDigest
    )
      throw new Error("Embedded plugin dependency digest mismatch");
  }
  const module = await import(pathToFileURL(join(root, "entry.mjs")).href);
  return module.default ?? module;
}
