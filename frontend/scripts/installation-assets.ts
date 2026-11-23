import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

// Next exports all of public/. Ship the account routes, their own chunks and icons.
const source = path.resolve("dist/installation-export");
const target = path.resolve("dist/installation/out");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of [
  "accounts",
  "setup",
  "studio",
  "workspaces",
  "_next",
  "favicon.ico",
  "favicon.png",
  "apple-touch-icon.png",
]) {
  await cp(path.resolve(source, name), path.resolve(target, name), {
    recursive: true,
  });
}
