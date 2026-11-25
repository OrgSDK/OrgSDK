import { join } from "node:path";
import { z } from "zod";
import {
  agentMountArguments,
  developmentSourceArguments,
  jobEnvironment,
} from "./executor-configuration";
import {
  spawnProcess,
  stopHostProcess,
  workerCommand,
} from "./process-runtime";

export function spawnJob(
  options: {
    base: string;
    agentId: string;
    directory: string;
    mode: "host" | "docker";
    name: string;
    browserSession?: boolean;
  },
  stdout: "pipe" | "ignore" = "ignore",
) {
  const { base, agentId, directory, mode, name } = options;
  const host = mode === "host";
  const command = host
    ? workerCommand(
        import.meta.url,
        options.browserSession ? "./session-browser-worker" : "./worker",
      )
    : [
        "docker",
        "run",
        "--add-host",
        "host.docker.internal:host-gateway",
        "--rm",
        "-i",
        "--name",
        name,
        "--network",
        z.string().min(1).parse(process.env.EXECUTION_NETWORK),
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=128m",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=128",
        "--memory=512m",
        "--cpus=1",
        "--user",
        `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`,
        ...agentMountArguments(agentId, directory),
        ...developmentSourceArguments(),
        "--workdir",
        "/agent/workspace",
        "-e",
        `ORGSDK_SERVER_URL=${base}`,
        "-e",
        "EXECUTOR_AGENT_DIR=/agent",
        ...(options.browserSession ? ["--entrypoint", "bun"] : []),
        z.string().min(1).parse(process.env.EXECUTOR_IMAGE),
        ...(options.browserSession
          ? ["--no-env-file", "/executor/src/session-browser-worker.ts"]
          : []),
      ];
  const child = spawnProcess(command, {
    cwd: join(directory, "workspace"),
    detached: host && process.platform !== "win32",
    env: jobEnvironment(base, directory, host),
    stdout,
    stderr: "ignore",
  });
  const kill = () => {
    if (host) {
      stopHostProcess(child);
      return;
    }
    void spawnProcess(["docker", "kill", name], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited.catch(() => undefined);
  };
  return { child, kill };
}
