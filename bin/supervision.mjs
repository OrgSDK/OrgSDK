import { once } from "node:events";
import { localAddress } from "./configuration.mjs";
import { spawn } from "node:child_process";
import process from "node:process";

function launch(entry, args, env, ipc = false) {
  const child = spawn(process.execPath, [entry, ...args], {
    stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
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

export async function supervise({
  server,
  executor,
  serverArgs = ["server"],
  executorArgs = ["manage"],
  onUpdate,
  env,
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
    const platform = launch(server, serverArgs, env, Boolean(executor));
    children.push(platform);
    if (executor) {
      const readiness = await Promise.race([
        once(platform.child, "message", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20_000),
          ]),
        }).then(([message]) => {
          if (
            !Number.isInteger(message?.port) ||
            message.port < 1 ||
            message.port > 65535
          ) {
            throw new Error("Invalid platform listener.");
          }
          return {
            address: localAddress(env.HOST ?? "127.0.0.1", message.port),
            port: message.port,
          };
        }),
        platform.closed,
      ]);
      if (!("address" in readiness)) {
        if (readiness.error) {
          throw readiness.error;
        }
        return requestedStatus ?? (exitStatus(readiness) || 1);
      }
      controller.signal.throwIfAborted();
      platform.child.on("message", (message) => {
        if (!stopping && onUpdate && typeof message?.update === "string") {
          onUpdate(message.update, readiness.port);
          requestedStatus = 0;
          void stop();
        }
      });
      children.push(
        launch(executor, executorArgs, {
          ...env,
          ORGSDK_SERVER_URL: readiness.address,
        }),
      );
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
