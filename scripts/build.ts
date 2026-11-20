import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { writeThirdPartyNotices } from "./third-party-notices";

const frontend = Bun.spawn(["npm", "--prefix", "frontend", "run", "build"], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await frontend.exited) !== 0) {
  throw new Error("Frontend build failed");
}

await mkdir("dist", { recursive: true });
await writeThirdPartyNotices();
const result = await Bun.build({
  entrypoints: ["./server/index.ts"],
  target: "bun",
  external: ["@node-rs/argon2"],
  plugins: [
    {
      name: "standalone-bun-database",
      setup(build) {
        build.onResolve({ filter: /\/node-driver$/ }, () => ({
          path: resolve("server/db/bun-driver.ts"),
        }));
      },
    },
  ],
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
console.log("Built dist/orgsdk and dist/THIRD_PARTY_NOTICES.txt");
