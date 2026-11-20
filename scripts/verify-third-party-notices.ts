import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function verifyThirdPartyNotices(path: string) {
  const notices = await readFile(path, "utf8");
  for (const name of [
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/core",
    "monaco-editor",
    "zod",
  ]) {
    assert(notices.includes(`${name}@`), `Missing release notice for ${name}`);
  }
  assert.match(notices, /Copyright/);
  assert.match(notices, /Apache License/);
  assert.match(notices, /Permission is hereby granted/);
}
