import { isAbsolute } from "node:path";
import { z } from "zod";
import { safeSegment } from "./plugin-store";

export function developmentSourceArguments(
  source = process.env.EXECUTOR_SOURCE_DIR,
): string[] {
  if (!source) return [];
  if (!isAbsolute(source) || /[,\n\r]/.test(source))
    throw new Error(
      "EXECUTOR_SOURCE_DIR must be an absolute host path without commas or newlines",
    );
  return ["--mount", `type=bind,src=${source},dst=/executor/src,readonly`];
}

export function agentMountArguments(
  agentId: string,
  directory: string,
): string[] {
  if (process.env.EXECUTOR_DATA_BIND === "1") {
    if (!isAbsolute(directory) || /[,\n\r]/.test(directory))
      throw new Error(
        "Agent bind directory must be absolute without commas or newlines",
      );
    return ["--mount", `type=bind,src=${directory},dst=/agent`];
  }
  return [
    "--mount",
    `type=volume,src=${z.string().min(1).parse(process.env.EXECUTOR_DATA_VOLUME)},dst=/agent,volume-subpath=agents/${safeSegment(agentId)}`,
  ];
}

export function jobEnvironment(
  base: string,
  agentPath: string,
  host: boolean,
): Record<string, string> {
  const inherited = host
    ? Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) =>
            value !== undefined &&
            !/(TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|BOOTSTRAP)/i.test(key),
        ),
      )
    : {};
  return {
    ...inherited,
    PATH: process.env.PATH || "",
    HOME: host ? process.env.HOME || agentPath : agentPath,
    DJANGO_URL: base,
    EXECUTOR_AGENT_DIR: agentPath,
  } as Record<string, string>;
}
