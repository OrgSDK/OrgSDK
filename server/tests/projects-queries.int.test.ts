import { expect, test } from "bun:test";
import { accessTokens, projects, workspaces } from "../db/schema";
import { appRouter } from "../router";
import { base } from "../shared/records";
import { rpcFixture } from "./rpc-fixture";

test("project SQL visibility combines direct projects and scoped immutable version grants", async () => {
  const fixture = rpcFixture();
  try {
    const caller = fixture.caller();
    const directProject = await caller.projects.create({
      name: "Directly granted",
    });
    const hiddenProject = await caller.projects.create({ name: "Hidden" });
    const saved = await caller.actions.saveAction({
      project: fixture.project.id,
      name: "Granted version",
      source: "return 1;",
    });
    const foreignWorkspace = fixture.store.db
      .insert(workspaces)
      .values({ name: "Other", host: "other.local", createdAt: fixture.time })
      .returning()
      .get();
    const foreignProject = fixture.store.db
      .insert(projects)
      .values({
        ...fixture.project,
        id: crypto.randomUUID(),
        workspaceId: foreignWorkspace.id,
      })
      .returning()
      .get();
    const token = fixture.store.db
      .insert(accessTokens)
      .values({
        ...base(fixture.workspace.id),
        actorId: fixture.user.id,
        name: "Scoped catalog",
        digest: "project-query-test",
        scopes: ["catalog:read"],
        projects: [directProject.id, foreignProject.id],
        actionVersions: [saved.version.id],
      })
      .returning()
      .get();
    const scopedCaller = appRouter.createCaller({
      ...fixture.context(),
      token,
    }).projects;
    expect(
      (await scopedCaller.list()).results.map((project) => project.id).sort(),
    ).toEqual([fixture.project.id, directProject.id].sort());
    expect((await scopedCaller.get({ id: fixture.project.id })).id).toBe(
      fixture.project.id,
    );
    expect((await scopedCaller.get({ id: directProject.id })).id).toBe(
      directProject.id,
    );
    for (const id of [hiddenProject.id, foreignProject.id]) {
      await Promise.resolve(
        expect(scopedCaller.get({ id })).rejects.toMatchObject({
          code: "NOT_FOUND",
        }),
      );
    }
    const ungrantedCaller = appRouter.createCaller({
      ...fixture.context(),
      token: { ...token, projects: [], actionVersions: [] },
    }).projects;
    expect((await ungrantedCaller.list()).results).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("project removal checks scoped retained resources and preserves unrelated projects", async () => {
  const fixture = rpcFixture();
  try {
    const caller = fixture.caller();
    const removable = await caller.projects.create({ name: "Removable" });
    await caller.actions.create({
      project: fixture.project.id,
      name: "Retained action",
    });
    await Promise.resolve(
      expect(
        caller.projects.delete({ id: fixture.project.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" }),
    );
    await caller.projects.delete({ id: removable.id });
    expect(
      (await caller.projects.list()).results.map((project) => project.id),
    ).toEqual([fixture.project.id]);
    const retainedRunProject = await caller.projects.create({
      name: "Retained run",
    });
    await caller.runs.create({
      project: retainedRunProject.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "retain",
    });
    await Promise.resolve(
      expect(
        caller.projects.delete({ id: retainedRunProject.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" }),
    );
  } finally {
    fixture.close();
  }
});
