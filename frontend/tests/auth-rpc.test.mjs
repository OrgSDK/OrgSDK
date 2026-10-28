import assert from "node:assert/strict";
import { test } from "node:test";
import { TRPCClientError } from "@trpc/client";
import {
  bootstrapAccount,
  isReauthenticationRequired,
  ReauthenticationRequired,
  requiresMfa,
} from "../src/api/auth.ts";

function rpcError(code, httpStatus) {
  return new TRPCClientError("Confirm your identity to continue.", {
    result: {
      error: {
        message: "Confirm your identity to continue.",
        code: -32001,
        data: { code, httpStatus },
      },
    },
  });
}

test("fresh identity prompts use native unauthorized errors, preserving other failures", () => {
  assert.equal(isReauthenticationRequired(rpcError("UNAUTHORIZED", 401)), true);
  assert.equal(
    isReauthenticationRequired(new ReauthenticationRequired()),
    true,
  );
  for (const error of [
    rpcError("FORBIDDEN", 403),
    rpcError("BAD_REQUEST", 400),
    new Error("Network unavailable"),
    { status: 401 },
    undefined,
  ]) {
    assert.equal(isReauthenticationRequired(error), false);
  }
  assert.match(new ReauthenticationRequired().message, /retry your change/);
});

test("account bootstrap reads the native session query and supplies the CSRF cookie", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const requests = [];
  globalThis.document = { cookie: "csrftoken=account-bootstrap" };
  globalThis.fetch = async (address, options) => {
    requests.push({ address: String(address), options });
    return globalThis.Response.json([
      { result: { data: { is_authenticated: false, user: null } } },
    ]);
  };
  try {
    await bootstrapAccount();
    assert.equal(requests.length, 1);
    assert.equal(
      new URL(requests[0].address, "http://localhost").pathname,
      "/trpc/auth.session",
    );
    assert.equal(requests[0].options.method, "GET");
    assert.equal(
      new Headers(requests[0].options.headers).get("x-csrftoken"),
      "account-bootstrap",
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  }
});

test("native pending MFA sessions keep the authentication challenge visible", () => {
  assert.equal(
    requiresMfa({
      user: null,
      is_authenticated: false,
      flows: [{ id: "mfa_authenticate" }],
    }),
    true,
  );
  assert.equal(
    requiresMfa({
      user: null,
      is_authenticated: false,
      flows: [{ id: "login" }],
    }),
    false,
  );
  assert.equal(
    requiresMfa({ user: null, is_authenticated: true, flows: [] }),
    false,
  );
});
