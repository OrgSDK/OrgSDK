import { expect, test } from "bun:test";
import { z } from "zod";
import { createApp } from "../app";
import { client, setup, store } from "./core-fixture";

const batchSchema = z.array(
  z.object({
    result: z.object({ data: z.unknown() }).optional(),
    error: z.object({ message: z.string() }).optional(),
  }),
);

test("a login in an HTTP batch cannot authenticate sibling procedures", async () => {
  const s = store();
  await client(s).auth.setup(setup);
  const response = await createApp(s)(
    new Request("https://localhost/trpc/auth.login,users.updateMe?batch=1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "csrftoken=test",
        "x-csrftoken": "test",
        origin: "https://localhost",
      },
      body: JSON.stringify({
        0: { email: setup.email, password: setup.password1 },
        1: { first_name: "Unauthorized" },
      }),
    }),
  );
  expect(response.status).toBe(207);
  const results = batchSchema.parse(await response.json());
  expect(results[0]?.result?.data).toMatchObject({ is_authenticated: true });
  expect(results[1]?.error?.message).toContain("Authentication required");
  expect(
    s.sqlite.query("SELECT first_name FROM users WHERE id=1").get(),
  ).toEqual({ first_name: "" });
  const session = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("sessionid="));
  expect(session).toContain("; Secure");
  expect(session).toContain("; HttpOnly");
  expect(session).toContain("; SameSite=Lax");
  s.close();
});
