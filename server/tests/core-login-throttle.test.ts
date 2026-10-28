import { expect, test } from "bun:test";
import { call, req, setup, store } from "./core-fixture";
test("password login throttles repeated attempts", async () => {
  const s = store();
  await call(s, req("/api/v1/setup/", "POST", setup));
  for (let i = 0; i < 10; i++)
    expect(
      (
        await call(
          s,
          req("/api/auth/browser/v1/auth/login", "POST", {
            email: setup.email,
            password: "wrong",
          }),
        )
      ).response.status,
    ).toBe(400);
  await Promise.resolve(
    expect(
      call(
        s,
        req("/api/auth/browser/v1/auth/login", "POST", {
          email: setup.email,
          password: "wrong",
        }),
      ),
    ).rejects.toThrow("Too many attempts"),
  );
  s.close();
});
