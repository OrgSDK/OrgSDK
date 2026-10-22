import { expect, test } from "bun:test";
import { requireSuccess, result } from "../src/api/result.ts";

test("successful no-content mutations do not require a response body", () => {
  expect(() =>
    requireSuccess({
      response: new globalThis.Response(null, { status: 204 }),
    }),
  ).not.toThrow();
});

test("no-content handling still rejects denied mutations", () => {
  expect(() =>
    requireSuccess({
      response: new globalThis.Response(null, { status: 403 }),
      error: { detail: "Permission denied" },
    }),
  ).toThrow("Permission denied");
});

test("read responses still require their expected data", () => {
  expect(() => result({})).toThrow("The request returned no data.");
});
