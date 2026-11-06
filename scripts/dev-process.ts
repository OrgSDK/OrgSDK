import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export function startChild(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const child = spawn(command, args, { stdio: "inherit", env, detached: true });
  const closed = new Promise<number>((resolve) => {
    child.once("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.once("close", (code) => resolve(code ?? 1));
  });
  return { child, closed };
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

export async function stopChildren(children: ReturnType<typeof startChild>[]) {
  for (const { child } of children) {
    signalGroup(child, "SIGTERM");
  }
  const timeout = setTimeout(() => {
    for (const { child } of children) {
      signalGroup(child, "SIGKILL");
    }
  }, 8000);
  try {
    await Promise.all(children.map(({ closed }) => closed));
  } finally {
    clearTimeout(timeout);
    for (const { child } of children) {
      signalGroup(child, "SIGKILL");
    }
  }
}

export async function waitForHealth(
  address: string,
  signal: AbortSignal,
  publicOrigin?: string,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(`${address}/trpc/system.health`, {
        ...(publicOrigin
          ? { headers: { Host: new URL(publicOrigin).host } }
          : {}),
        signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
      });
      if (response.ok) {
        return;
      }
    } catch {
      signal.throwIfAborted();
    }
    await sleep(100, undefined, { signal });
  }
  throw new Error("Development API did not become ready.");
}
