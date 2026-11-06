import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startChild, stopChildren, waitForHealth } from "./dev-process";

const binary = resolve(process.argv[2] ?? "dist/orgsdk");
const directory = await mkdtemp(join(tmpdir(), "orgsdk-binary-"));
const port = process.env.ORGSDK_SMOKE_PORT ?? "18785";
const address = `http://127.0.0.1:${port}`;
const original = process.cwd();
process.chdir(directory);
const child = startChild(binary, [], {
  PATH: "/nonexistent",
  ORGSDK_DATA_DIR: join(directory, "data"),
  HOST: "127.0.0.1",
  PORT: port,
});
try {
  await Promise.race([
    waitForHealth(address, AbortSignal.timeout(15_000)),
    child.closed.then(() => {
      throw new Error("Standalone executable exited before readiness.");
    }),
  ]);
  const html = await fetch(address);
  if (!html.ok || !(await html.text()).includes("<html")) {
    throw new Error("Standalone executable did not serve HTML.");
  }
  if (!(await fetch(`${address}/monaco/vs/loader.js`)).ok) {
    throw new Error("Standalone executable did not serve Monaco.");
  }
  console.log(
    "Standalone executable served health, HTML and Monaco with an empty working directory and PATH.",
  );
} finally {
  await stopChildren([child]);
  process.chdir(original);
  await rm(directory, { recursive: true, force: true });
}
