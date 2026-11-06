import { expect, test } from "bun:test";
import { auditRecords, plugins, projects, workspaces } from "../db/schema";
import { base } from "../shared/records";
import { digest } from "../shared/security";
import { rpcFixture } from "./rpc-fixture";

test("plugin reads and mutations hide installations owned by another workspace", async () => {
  const fixture = rpcFixture();
  try {
    const workspace = fixture.store.db
      .insert(workspaces)
      .values({
        name: "Foreign",
        host: "foreign.local",
        createdAt: fixture.time,
      })
      .returning()
      .get();
    const project = fixture.store.db
      .insert(projects)
      .values({
        ...fixture.project,
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
      })
      .returning()
      .get();
    const foreignPlugin = fixture.store.db
      .insert(plugins)
      .values({
        ...base(workspace.id),
        projectId: project.id,
        slug: "foreign-plugin",
        version: "1",
        source: "export default () => 1;",
        digest: digest("export default () => 1;"),
      })
      .returning()
      .get();
    const caller = fixture.caller().plugins;

    expect((await caller.list()).results).toEqual([]);
    await Promise.resolve(
      expect(caller.get({ id: foreignPlugin.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      }),
    );
    await Promise.resolve(
      expect(
        caller.update({ id: foreignPlugin.id, enabled: false }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" }),
    );
    await Promise.resolve(
      expect(caller.delete({ id: foreignPlugin.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      }),
    );
    expect(fixture.store.db.select().from(plugins).all()).toEqual([
      foreignPlugin,
    ]);
    expect(fixture.store.db.select().from(auditRecords).all()).toEqual([]);
  } finally {
    fixture.close();
  }
});
