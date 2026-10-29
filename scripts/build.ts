import { mkdir } from "node:fs/promises";

const frontend = Bun.spawn(["npm", "--prefix", "frontend", "run", "build"], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await frontend.exited) !== 0) {
  throw new Error("Frontend build failed");
}

await mkdir("dist", { recursive: true });
const result = await Bun.build({
  entrypoints: ["./server/index.ts"],
  target: "bun",
  compile: {
    outfile: "./dist/orgsdk",
    assets: ["./frontend/out", "./server/db/migrations"],
  },
});
if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  throw new Error("Executable build failed");
}
console.log("Built dist/orgsdk with the complete static frontend");
