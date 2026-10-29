import { expect, test } from "bun:test";
import { client, setup, store } from "./core-fixture";
test("RPC mutations require matching CSRF token and same origin", async () => {
  const s = store();
  await Promise.resolve(
    expect(
      client(s, "csrftoken=test", "localhost", {
        origin: "http://evil.example",
      }).auth.setup(setup),
    ).rejects.toThrow("Invalid origin"),
  );
  await Promise.resolve(
    expect(
      client(s, "", "localhost", { "x-csrftoken": "" }).auth.setup(setup),
    ).rejects.toThrow("CSRF verification failed"),
  );
  expect(await client(s).auth.setupStatus()).toMatchObject({
    setup_required: true,
  });
  s.close();
});
