import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** Source development uses Bun; installed workers always execute built JavaScript. */
export function workerCommand(moduleUrl: string, worker: string): string[] {
  const extension = moduleUrl.endsWith(".ts") ? ".ts" : ".js";
  return [
    process.execPath,
    ...(process.versions.bun ? ["--no-env-file"] : []),
    fileURLToPath(new URL(`${worker}${extension}`, moduleUrl)),
  ];
}

export function isEntrypoint(moduleUrl: string): boolean {
  return (
    !!process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === moduleUrl
  );
}

export async function readStdin(maximumBytes = Infinity): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) throw new Error("Process input exceeds limit");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function spawnProcess(
  command: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    stdout?: "pipe" | "ignore";
    stderr?: "pipe" | "ignore";
  } = {},
) {
  const executable = command[0];
  if (!executable) throw new Error("Process command must not be empty");
  const child = spawn(executable, command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    detached: options.detached,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Draining ignored output also keeps the same stream types for all callers.
  if (options.stdout === "ignore") child.stdout.resume();
  if (options.stderr === "ignore") child.stderr.resume();
  child.stdin.on("error", () => {});
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    get pid() {
      return child.pid;
    },
    kill: (signal?: NodeJS.Signals) => child.kill(signal),
    exited,
  };
}

export function stopHostProcess(child: {
  readonly pid: number | undefined;
  kill: (signal?: NodeJS.Signals) => boolean;
}): void {
  if (process.platform === "win32" || !child.pid) {
    child.kill("SIGKILL");
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
