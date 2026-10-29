import assert from "node:assert/strict";
import { z } from "zod";

export async function verifyApplicationHttpContract(
  origin: string,
): Promise<void> {
  const cookies = new Map<string, string>();
  async function request(
    procedure: string,
    input?: unknown,
    csrf = true,
  ): Promise<Response> {
    const response = await fetch(`${origin}/trpc/${procedure}`, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
        Origin: origin,
        ...(csrf ? { "X-CSRFToken": cookies.get("csrftoken") ?? "" } : {}),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      assert.ok(pair);
      const separator = pair.indexOf("=");
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
  async function data(procedure: string, input?: unknown): Promise<unknown> {
    const response = await request(procedure, input);
    const body: unknown = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return z.object({ result: z.object({ data: z.unknown() }) }).parse(body)
      .result.data;
  }
  assert.deepEqual(await data("system.health"), {
    status: "ok",
    database: "sqlite",
    runtime: typeof Bun === "undefined" ? "node" : "bun",
  });
  assert.equal(
    z
      .object({ setup_required: z.boolean() })
      .parse(await data("auth.setupStatus")).setup_required,
    true,
  );
  const account = {
    domain: "127.0.0.1",
    workspace_name: "Runtime contract workspace",
    username: "owner",
    email: "owner@example.test",
    password1: "A-strong-contract-password-123",
    password2: "A-strong-contract-password-123",
    project_name: "Persistent contract project",
  };
  assert.equal(
    z
      .object({ setup_required: z.boolean() })
      .parse(await data("auth.setup", account)).setup_required,
    false,
  );
  assert.equal(
    z.object({ is_authenticated: z.boolean() }).parse(
      await data("auth.login", {
        email: account.email,
        password: account.password1,
      }),
    ).is_authenticated,
    true,
  );
  const session = () =>
    data("auth.session").then((value) =>
      z.object({ is_authenticated: z.boolean() }).parse(value),
    );
  assert.equal((await session()).is_authenticated, true);
  const projects = z
    .object({ results: z.array(z.object({ name: z.string() })) })
    .parse(await data("projects.list"));
  assert.deepEqual(
    projects.results.map((project) => project.name),
    [account.project_name],
  );
  const rejectedLogout = await request("auth.logout", {}, false);
  assert.equal(rejectedLogout.status, 403);
  await rejectedLogout.arrayBuffer();
  assert.equal((await session()).is_authenticated, true);
  await data("auth.logout", {});
  assert.equal((await session()).is_authenticated, false);
}
