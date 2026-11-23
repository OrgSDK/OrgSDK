import assert from "node:assert/strict";

export async function verifyStudioDistribution(origin: string): Promise<void> {
  const root = await fetch(origin, { redirect: "manual" });
  assert.equal(root.status, 302);
  const target = new URL(root.headers.get("location") ?? "");
  assert.equal(target.origin, "https://studio.orgsdk.ai");
  assert.equal(target.searchParams.get("server"), origin);
  for (const path of [
    "/index.html",
    "/actions/index.html",
    "/monaco/vs/loader.js",
    "/sw.js",
  ]) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
}
