import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

function launch(entry, args, env) {
  const child = spawn(process.execPath, [entry, ...args], {
    stdio: "inherit",
    env,
    detached: process.platform !== "win32",
  });
  const closed = new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: 1, error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return { child, closed };
}

function signalChild(child, signal) {
  if (!child.pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") {
      throw error;
    }
  }
}

function exitStatus(result) {
  if (result.code !== null && result.code !== undefined) {
    return result.code;
  }
  return result.signal === "SIGINT" ? 130 : 143;
}

async function waitForServer(address, signal, publicOrigin) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(`${address}/trpc/system.health`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
        ...(publicOrigin
          ? { headers: { Host: new URL(publicOrigin).host } }
          : {}),
      });
      if (response.ok) {
        const health = await response.json();
        if (health?.result?.data?.status === "ok") {
          return;
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof Error)) {
        throw error;
      }
    }
    await delay(200, undefined, { signal });
  }
  throw new Error("Platform did not become ready within 20 seconds.");
}

export async function supervise({
  server,
  executor,
  serverArgs = ["server"],
  executorArgs = ["manage"],
  env,
  address,
}) {
  const children = [];
  const controller = new AbortController();
  let stopping;
  let requestedStatus;
  function stop(signal = "SIGTERM") {
    if (stopping) {
      return stopping;
    }
    controller.abort();
    for (const { child } of children) {
      signalChild(child, signal);
    }
    stopping = (async () => {
      const timeout = setTimeout(() => {
        for (const { child } of children) {
          signalChild(child, "SIGKILL");
        }
      }, 8000);
      try {
        await Promise.all(children.map(({ closed }) => closed));
      } finally {
        clearTimeout(timeout);
        // A child may exit before a worker; terminate any remaining descendants.
        for (const { child } of children) {
          signalChild(child, "SIGKILL");
        }
      }
    })();
    return stopping;
  }
  const onInterrupt = () => {
    requestedStatus = 130;
    void stop("SIGINT");
  };
  const onTerminate = () => {
    requestedStatus = 143;
    void stop();
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    const platform = launch(server, serverArgs, env);
    children.push(platform);
    if (executor) {
      const readiness = await Promise.race([
        waitForServer(
          address,
          controller.signal,
          env.ORGSDK_PUBLIC_ORIGIN,
        ).then(() => undefined),
        platform.closed,
      ]);
      if (readiness) {
        if (readiness.error) {
          throw readiness.error;
        }
        return requestedStatus ?? (exitStatus(readiness) || 1);
      }
      controller.signal.throwIfAborted();
      children.push(launch(executor, executorArgs, env));
    }
    const result = await Promise.race(children.map(({ closed }) => closed));
    if (result.error) {
      throw result.error;
    }
    return (
      requestedStatus ??
      (executor ? exitStatus(result) || 1 : exitStatus(result))
    );
  } catch (error) {
    if (requestedStatus) {
      return requestedStatus;
    }
    throw error;
  } finally {
    await stop();
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}
