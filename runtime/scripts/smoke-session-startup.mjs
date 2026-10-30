import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function verifySessionStartupFailure(
  packageDirectory,
  runtimeLabel,
) {
  const moduleUrl = pathToFileURL(
    join(packageDirectory, "dist/sessions/process.js"),
  ).href;
  const script = `
    import assert from "node:assert/strict";
    const {SessionProcess} = await import(${JSON.stringify(moduleUrl)});
    let exits = 0;
    const session = new SessionProcess({id:crypto.randomUUID(),generation:1,mode:"docker",workspaceDirectory:"/tmp"}, {event(){}, async call(){}, exit(){exits++;}});
    await assert.rejects(session.initialize([],1000), /ENOENT|Session worker exited/);
    await session.stop();
    assert.equal(exits,1);
    console.log("Missing Docker startup was caught and cleaned up");
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      env: { PATH: "" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk.toString();
  });
  child.stdout.resume();
  const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(code, 0, errors);
    console.log(
      `${runtimeLabel} session startup failure passed: missing Docker rejects cleanly without crashing the parent.`,
    );
  } finally {
    clearTimeout(deadline);
  }
}
