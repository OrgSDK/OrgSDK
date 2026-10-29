import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";

export function requireDockerConfiguration(env) {
  for (const name of ["EXECUTOR_IMAGE", "EXECUTION_NETWORK"]) {
    if (!env[name]?.trim()) {
      throw new Error(`Docker mode requires ${name}. See orgsdk --help.`);
    }
  }
  if (env.EXECUTOR_DATA_BIND !== "1" && !env.EXECUTOR_DATA_VOLUME?.trim()) {
    throw new Error(
      "Docker mode requires EXECUTOR_DATA_BIND=1 or EXECUTOR_DATA_VOLUME.",
    );
  }
}

export async function requireAvailablePort(host, port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen({ host, port: Number(port), exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function bootstrapToken(dataDirectory) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const filename = join(dataDirectory, "local-executor.token");
  try {
    await writeFile(filename, randomBytes(32).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
  await chmod(filename, 0o600);
  const token = (await readFile(filename, "utf8")).trim();
  if (token.length < 32) {
    throw new Error(
      "Invalid local-executor.token; restore the installation credential.",
    );
  }
  return token;
}

export function localAddress(host, port) {
  const address = ["0.0.0.0", "::", "[::]"].includes(host) ? "127.0.0.1" : host;
  const hostname =
    address.includes(":") && !address.startsWith("[")
      ? `[${address}]`
      : address;
  return `http://${hostname}:${port}`;
}
