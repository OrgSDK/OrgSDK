import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNextPath } from "../src/api/auth.ts";

test("account redirects accept local paths and reject external or malformed destinations", () => {
  const originalLocation = globalThis.location;
  globalThis.location = { origin: "https://orgsdk.example" };
  try {
    assert.equal(
      safeNextPath("?next=%2Fsettings%2F%3Ftab%3Daccount%23password"),
      "/settings/?tab=account#password",
    );
    for (const destination of [
      "https://other.example",
      "//other.example",
      "/\\other.example",
      "/\n/other.example",
      "javascript:alert(1)",
      "",
    ]) {
      assert.equal(
        safeNextPath(`?next=${encodeURIComponent(destination)}`),
        "/",
      );
    }
  } finally {
    globalThis.location = originalLocation;
  }
});
