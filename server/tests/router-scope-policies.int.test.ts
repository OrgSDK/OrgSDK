import { expect, test } from "bun:test";
import { rpcFixture } from "./rpc-fixture";

test("static client scopes are checked before resource lookup across project, action and run routers", async () => {
  const fixture = rpcFixture();
  try {
    const reader = await fixture.caller().tokens.create({
      name: "Run reader",
      scopes: ["runs:read"],
      projects: [fixture.project.id],
    });
    for (const path of [
      "projects.list",
      "projects.get",
      "projects.sdk",
      "actions.list",
      "actions.get",
      "actions.versions",
      "actions.version",
      "actions.tests",
    ]) {
      expect(
        (
          await fixture.rpc(
            path,
            { id: fixture.project.id },
            "query",
            reader.token,
          )
        ).status,
        path,
      ).toBe(403);
    }
    expect(
      (await fixture.rpc("runs.list", undefined, "query", reader.token)).status,
    ).toBe(200);
    expect(
      (
        await fixture.rpc(
          "runs.get",
          { id: crypto.randomUUID() },
          "query",
          reader.token,
        )
      ).status,
    ).toBe(404);
    const catalog = await fixture.caller().tokens.create({
      name: "Catalog reader",
      scopes: ["catalog:read"],
      projects: [fixture.project.id],
    });
    for (const path of ["runs.list", "runs.get", "runs.events"]) {
      expect(
        (
          await fixture.rpc(
            path,
            { id: fixture.project.id },
            "query",
            catalog.token,
          )
        ).status,
        path,
      ).toBe(403);
    }
    expect(
      (await fixture.rpc("projects.list", undefined, "query", catalog.token))
        .status,
    ).toBe(200);
    const deniedStream = await fixture.rpc(
      "runs.stream",
      { id: fixture.project.id },
      "query",
      catalog.token,
    );
    expect(deniedStream.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    expect(await deniedStream.text()).toContain("FORBIDDEN");
    await Promise.resolve(
      expect(
        fixture.caller(catalog.token).runs.stream({ id: fixture.project.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" }),
    );
    for (const path of [
      "actions.create",
      "actions.update",
      "actions.createVersion",
      "actions.saveTests",
      "actions.saveAction",
      "actions.runTests",
      "actions.validateCode",
      "runs.cancel",
      "runs.promote",
    ]) {
      expect(
        (await fixture.rpc(path, {}, "mutation", reader.token)).status,
        path,
      ).toBe(403);
    }
    await Promise.resolve(
      expect(
        fixture.caller(reader.token).runs.cancel({ id: fixture.project.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" }),
    );
    await Promise.resolve(
      expect(
        fixture
          .caller(reader.token)
          .runs.promote({ id: fixture.project.id, name: "Denied promotion" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" }),
    );
    const author = await fixture.caller().tokens.create({
      name: "Author without run visibility",
      scopes: ["actions:write"],
      projects: [fixture.project.id],
    });
    await Promise.resolve(
      expect(
        fixture
          .caller(author.token)
          .runs.promote({ id: fixture.project.id, name: "Also denied" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" }),
    );
  } finally {
    fixture.close();
  }
});
