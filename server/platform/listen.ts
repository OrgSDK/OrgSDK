import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { databaseFilename } from "../db/migrate";
import { serve } from "./server";

export function installationPorts(
  directory: string,
  hostname: string,
): number[] {
  const explicit = process.env.PORT;
  if (explicit !== undefined) {
    const port = Number(explicit);
    if (
      !/^\d+$/.test(explicit) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error("PORT must be between 1 and 65535.");
    }
    return [port];
  }
  const record = join(directory, "server.port");
  const saved = existsSync(record)
    ? Number(readFileSync(record, "utf8").trim())
    : undefined;
  if (
    saved !== undefined &&
    (!Number.isInteger(saved) || saved < 1 || saved > 65535)
  ) {
    throw new Error(
      "Invalid saved installation port. Specify PORT to select a port.",
    );
  }
  if (
    !["127.0.0.1", "localhost", "::1"].includes(hostname) ||
    process.env.ORGSDK_PUBLIC_ORIGIN
  ) {
    return [saved ?? 8080];
  }
  if (saved === undefined && existsSync(join(directory, databaseFilename))) {
    return [8080];
  }
  if (saved === 8080) {
    return [8080];
  }
  const defaults = Array.from({ length: 8 }, (_, index) => 28940 + index);
  return saved === undefined ? defaults : [...new Set([saved, ...defaults])];
}

export async function listenOnInstallationPort(
  ports: number[],
  options: Omit<Parameters<typeof serve>[0], "port">,
) {
  for (const port of ports) {
    try {
      return await serve({ ...options, port });
    } catch (error) {
      if (
        ports.length === 1 ||
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EADDRINUSE"
      ) {
        throw error;
      }
    }
  }
  throw new Error(
    "The OrgSDK ports are occupied. Specify a free port with --port or PORT.",
  );
}
export function rememberPort(directory: string, port: number) {
  const file = join(directory, "server.port");
  const temp = file + "." + String(process.pid);
  writeFileSync(temp, String(port) + "\n", { mode: 0o600 });
  renameSync(temp, file);
}
