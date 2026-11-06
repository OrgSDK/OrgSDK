import { expect, test } from "bun:test";
import {
  accessTokens,
  conversations,
  projects,
  workspaces,
} from "../db/schema";
import { base } from "../shared/records";
import { digest } from "../shared/security";
import { rpcFixture } from "./rpc-fixture";

test("native archived conversation queries return only the active workspace and reject writes", async () => {
  const f = rpcFixture();
  try {
    const conversation = f.store.db
      .insert(conversations)
      .values({
        ...base(f.workspace.id),
        projectId: f.project.id,
        title: "Retained history",
      })
      .returning()
      .get();
    const foreignWorkspace = f.store.db
      .insert(workspaces)
      .values({ name: "Other", host: "other.local", createdAt: f.time })
      .returning()
      .get();
    const foreignProject = f.store.db
      .insert(projects)
      .values({
        ...f.project,
        id: crypto.randomUUID(),
        workspaceId: foreignWorkspace.id,
      })
      .returning()
      .get();
    const foreignConversation = f.store.db
      .insert(conversations)
      .values({
        ...base(foreignWorkspace.id),
        projectId: foreignProject.id,
        title: "Private",
      })
      .returning()
      .get();
    const caller = f.caller().conversations;
    const listed = (await caller.list()).results;
    expect(listed).toEqual([
      {
        id: conversation.id,
        project: f.project.id,
        title: conversation.title,
        created_at: conversation.createdAt,
        updated_at: conversation.updatedAt,
      },
    ]);
    expect(await caller.get({ id: conversation.id })).toEqual(listed[0]!);
    await Promise.resolve(
      expect(caller.get({ id: foreignConversation.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      }),
    );
    expect((await f.rpc("conversations.get", { id: "invalid" })).status).toBe(
      400,
    );
    expect(
      (
        await f.rpc(
          "conversations.create",
          { project: f.project.id },
          "mutation",
        )
      ).status,
    ).toBe(404);
    f.store.db
      .insert(accessTokens)
      .values({
        ...base(f.workspace.id),
        actorId: f.user.id,
        name: "Client",
        digest: digest("conversation-client"),
        scopes: ["catalog:read"],
        projects: [f.project.id],
      })
      .run();
    expect(
      (
        await f.rpc(
          "conversations.list",
          undefined,
          "query",
          "conversation-client",
        )
      ).status,
    ).toBe(403);
  } finally {
    f.close();
  }
});
