import { expect, test } from "bun:test";
import { checkCsrf, createContext } from "../http/context";
import { HttpError } from "../http/responses";
import { store } from "./core-fixture";
test("unsafe requests require matching token and same origin", () => {
  const s = store();
  const ctx = createContext(
    new Request("http://localhost/api/v1/setup/", {
      method: "POST",
      headers: {
        cookie: "csrftoken=a",
        "x-csrftoken": "a",
        origin: "http://evil.example",
      },
    }),
    s,
  );
  expect(() => checkCsrf(ctx)).toThrow(HttpError);
  expect(() =>
    checkCsrf(
      createContext(
        new Request("http://localhost/api/v1/setup/", { method: "POST" }),
        s,
      ),
    ),
  ).toThrow(HttpError);
  s.close();
});
