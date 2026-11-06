import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { memberships, sessions } from "../db/schema/core";
import { rpcFixture } from "./rpc-fixture";

const browserReads = [
  "documents.list",
  "tables.list",
  "credentials.list",
  "plugins.list",
  "plugins.catalog",
  "plugins.marketplace",
  "approvals.list",
  "artifacts.list",
  "schedules.list",
  "webhooks.list",
  "conversations.list",
  "tokens.list",
  "audit.list",
  "workspace.current",
  "workspace.list",
  "users.me",
  "auth.emails",
];
const managerMutations = [
  "projects.create",
  "projects.update",
  "projects.delete",
  "projects.connectExecutor",
  "projects.disconnectExecutor",
  "plugins.create",
  "plugins.update",
  "plugins.delete",
  "credentials.create",
  "credentials.update",
  "credentials.delete",
  "credentials.beginOAuth",
  "tokens.create",
  "tokens.revoke",
  "tables.create",
  "tables.update",
  "tables.delete",
  "approvals.decide",
  "webhooks.create",
  "webhooks.update",
  "webhooks.rotate",
  "workspace.update",
  "workspace.invite",
  "workspace.revokeInvitation",
];

test("browser policies reject client tokens across all browser-only modules, including mixed batches", async () => {
  const fixture = rpcFixture();
  try {
    const issued = await fixture.caller().tokens.create({
      name: "Browser policy probe",
      scopes: ["catalog:read"],
      projects: [fixture.project.id],
    });
    for (const path of browserReads) {
      expect(
        (await fixture.rpc(path, undefined, "query", issued.token)).status,
        path,
      ).toBe(403);
    }
    for (const path of managerMutations) {
      expect(
        (await fixture.rpc(path, {}, "mutation", issued.token)).status,
        path,
      ).toBe(403);
    }
    const caller = fixture.caller(issued.token);
    await Promise.resolve(
      expect(caller.documents.list()).rejects.toMatchObject({
        code: "FORBIDDEN",
      }),
    );
    await Promise.resolve(
      expect(
        caller.credentials.create({
          name: "Denied",
          provider: "test",
          secret: {},
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" }),
    );
    expect((await caller.projects.list()).results[0]?.id).toBe(
      fixture.project.id,
    );
    const batch = await fixture.request(
      "/trpc/projects.list,documents.list?batch=1&input=%7B%7D",
      "GET",
      undefined,
      issued.token,
    );
    expect(batch.status).toBe(207);
    const response = await batch.text();
    expect(response).toContain(fixture.project.id);
    expect(response).toContain("FORBIDDEN");
  } finally {
    fixture.close();
  }
});

test("member policies allow browser reads while rejecting manager mutations before input handling", async () => {
  const fixture = rpcFixture();
  try {
    fixture.store.db
      .update(memberships)
      .set({ role: "member" })
      .where(eq(memberships.userId, fixture.user.id))
      .run();
    for (const path of managerMutations) {
      expect((await fixture.rpc(path, {}, "mutation")).status, path).toBe(403);
    }
    for (const path of [
      "documents.list",
      "tables.list",
      "credentials.list",
      "plugins.list",
      "schedules.list",
      "webhooks.list",
      "approvals.list",
      "artifacts.list",
      "conversations.list",
      "workspace.current",
    ]) {
      expect((await fixture.rpc(path)).status, path).toBe(200);
    }
    for (const path of ["tokens.list", "audit.list"]) {
      expect((await fixture.rpc(path)).status, path).toBe(403);
    }
    const document = await fixture.caller().documents.create({
      title: "Member document",
      kind: "document",
      content: "Permitted",
    });
    expect(document.content).toBe("Permitted");
    for (const path of ["documents.list", "projects.list", "users.me"]) {
      expect(
        (
          await fixture.request(`/trpc/${path}`, "GET", undefined, undefined, {
            cookie: "csrftoken=test",
          })
        ).status,
        path,
      ).toBe(401);
    }
  } finally {
    fixture.close();
  }
});

test("account middleware allows identity without membership and enforces recent confirmation independently", async () => {
  const fixture = rpcFixture();
  try {
    fixture.store.db
      .delete(memberships)
      .where(eq(memberships.userId, fixture.user.id))
      .run();
    expect((await fixture.caller().users.me()).id).toBe(fixture.user.id);
    expect((await fixture.caller().auth.emails())[0]?.email).toBe(
      fixture.user.email,
    );
    await Promise.resolve(
      expect(fixture.caller().workspace.current()).rejects.toMatchObject({
        code: "FORBIDDEN",
      }),
    );
    await Promise.resolve(
      expect(
        fixture.caller().auth.changeEmail({ email: "new@example.test" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" }),
    );
    fixture.store.db
      .update(sessions)
      .set({ reauthenticatedAt: Date.now() })
      .where(eq(sessions.userId, fixture.user.id))
      .run();
    expect(
      (
        await fixture.caller().auth.changeEmail({ email: "new@example.test" })
      )[0]?.email,
    ).toBe("new@example.test");
    await Promise.resolve(
      expect(fixture.caller().workspace.current()).rejects.toMatchObject({
        code: "FORBIDDEN",
      }),
    );
  } finally {
    fixture.close();
  }
});
