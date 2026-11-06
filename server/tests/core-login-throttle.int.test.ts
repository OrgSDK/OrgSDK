import { expect, test } from "bun:test";
import { client, setup, store } from "./core-fixture";
test("password login throttles repeated attempts", async () => {
  const s = store();
  await client(s).auth.setup(setup);
  for (let i = 0; i < 10; i++) {
    await Promise.resolve(
      expect(
        client(s).auth.login({ email: setup.email, password: "wrong" }),
      ).rejects.toThrow("Invalid email or password"),
    );
  }
  await Promise.resolve(
    expect(
      client(s).auth.login({ email: setup.email, password: "wrong" }),
    ).rejects.toThrow("Too many attempts"),
  );
  s.close();
});
