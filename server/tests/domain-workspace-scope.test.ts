import { expect, test } from "bun:test";
import { projects } from "../db/schema";
import { workspaces } from "../db/schema/core";
import { rpcFixture } from "./rpc-fixture";

test("native project query cannot read a project from another workspace", async () => {
  const f = rpcFixture();
  try {
    const foreign = f.store.db
      .insert(workspaces)
      .values({ name: "B", host: "b.local", createdAt: f.time })
      .returning()
      .get();
    const project = f.store.db
      .insert(projects)
      .values({
        ...f.project,
        id: crypto.randomUUID(),
        workspaceId: foreign.id,
        name: "Secret",
      })
      .returning()
      .get();
    await Promise.resolve(
      expect(f.caller().projects.get({ id: project.id })).rejects.toThrow(
        "Not found.",
      ),
    );
    const response = await f.rpc("projects.get", { id: project.id });
    expect(response.status).toBe(404);
  } finally {
    f.close();
  }
});
