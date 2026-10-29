import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finishSignIn,
  redirectToSignIn,
  safeNextPath,
} from "../src/api/auth.ts";

test("signed-out visits replace history with sign-in and return to the full local URL", () => {
  const originalLocation = globalThis.location;
  try {
    for (const next of [
      "/",
      "/actions/?project=project-a&action=action-a#code",
    ]) {
      const current = new URL(next, "https://orgsdk.example");
      let replaced;
      let assigned;
      globalThis.location = {
        origin: current.origin,
        pathname: current.pathname,
        search: current.search,
        hash: current.hash,
        replace: (href) => {
          replaced = new URL(href, current.origin);
        },
        assign: (href) => {
          assigned = href;
        },
      };
      redirectToSignIn();
      assert.equal(replaced.pathname, "/accounts/login/");
      assert.equal(replaced.searchParams.get("next"), next);
      globalThis.location.search = replaced.search;
      finishSignIn();
      assert.equal(assigned, next);
    }
  } finally {
    globalThis.location = originalLocation;
  }
});

test("account redirects accept local paths and reject external or malformed destinations", () => {
  const originalLocation = globalThis.location;
  globalThis.location = { origin: "https://orgsdk.example" };
  try {
    assert.equal(
      safeNextPath("?next=%2Fsettings%2F%3Ftab%3Daccount%23password"),
      "/settings/?tab=account#password",
    );
    for (let code = 0; code <= 32; code += 1) {
      const destination = `/actions/${String.fromCodePoint(code)}/other.example`;
      assert.equal(
        safeNextPath(`?next=${encodeURIComponent(destination)}`),
        "/",
      );
    }
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
