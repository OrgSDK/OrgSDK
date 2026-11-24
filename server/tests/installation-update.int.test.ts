import { expect, test } from "bun:test";
import { rpcFixture } from "./rpc-fixture";
import { newerStable } from "../platform/stable-release";
import { memberships, projects, runs, workspaces } from "../db/schema";
import { updateBlockers } from "../platform/installation-update";

test("updates accept only strictly newer stable versions", () => {
  expect(newerStable("2.10.0", "2.9.1")).toBe(true);
  for (const candidate of [
    "2.1.0",
    "1.99.99",
    "2.2.0-rc.1",
    "latest",
    "02.2.0",
    "../2.2.0",
    "2.3.0\n",
  ]) {
    expect(newerStable(candidate, "2.1.0")).toBe(false);
  }
});

test("restart blockers count active runs and approvals for the current workspace", () => {
  const fixture = rpcFixture();
  const { db } = fixture.store;
  try {
    const otherWorkspace = db
      .insert(workspaces)
      .values({
        host: "other.localhost",
        name: "Other",
        createdAt: fixture.time,
      })
      .returning({ id: workspaces.id })
      .get();
    const otherProjectId = crypto.randomUUID();
    db.insert(projects)
      .values({
        id: otherProjectId,
        workspaceId: otherWorkspace.id,
        name: "Other project",
        createdAt: fixture.time,
        updatedAt: fixture.time,
      })
      .run();
    const statuses = [
      "running",
      "running",
      "waiting_approval",
      "queued",
      "succeeded",
    ];
    const records = statuses.map((status) => ({
      id: crypto.randomUUID(),
      workspaceId: fixture.workspace.id,
      projectId: fixture.project.id,
      actorId: fixture.user.id,
      status,
      operation: "execute",
      idempotencyKey: crypto.randomUUID(),
      createdAt: fixture.time,
      updatedAt: fixture.time,
    }));
    db.insert(runs)
      .values([
        ...records,
        {
          id: crypto.randomUUID(),
          workspaceId: otherWorkspace.id,
          projectId: otherProjectId,
          actorId: fixture.user.id,
          status: "running",
          operation: "execute",
          idempotencyKey: crypto.randomUUID(),
          createdAt: fixture.time,
          updatedAt: fixture.time,
        },
      ])
      .run();
    expect(updateBlockers(db, fixture.workspace.id)).toEqual({
      running: 2,
      awaitingApproval: 1,
    });
    expect(updateBlockers(db, otherWorkspace.id)).toEqual({
      running: 1,
      awaitingApproval: 0,
    });
  } finally {
    fixture.close();
  }
});

test("a server without its launcher and non-owner clients cannot request installation changes", async () => {
  const fixture = rpcFixture();
  try {
    expect(
      (
        await fixture.rpc(
          "system.requestUpdate",
          { version: "2.2.0" },
          "mutation",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fixture.rpc(
          "system.requestUpdate",
          { version: "latest" },
          "mutation",
        )
      ).status,
    ).toBe(400);
    const issued = await fixture.caller().tokens.create({
      name: "Update permission test",
      scopes: ["catalog:read"],
      projects: [fixture.project.id],
    });
    fixture.store.db.update(memberships).set({ role: "admin" }).run();
    expect(
      (
        await fixture.rpc(
          "system.requestUpdate",
          { version: "2.2.0" },
          "mutation",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fixture.rpc(
          "system.requestUpdate",
          { version: "2.2.0" },
          "mutation",
          issued.token,
        )
      ).status,
    ).toBe(403);
  } finally {
    fixture.close();
  }
});
