import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { accessTokens, auditRecords, memberships, users } from "../db/schema";
import { digest } from "../shared/security";
import { automationFixture } from "./automation-fixture";

test("native tokens enforce modern scopes, workspace grants, and one-time secrets", async () => {
  const f = await automationFixture();
  try {
    const caller = f.caller();
    const created = await caller.tokens.create({
      name: "Client",
      scopes: ["catalog:read"],
      projects: [f.project.id],
      action_versions: [f.saved.version.id],
    });
    expect(
      f.store.db
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.id, created.id))
        .get()?.digest,
    ).toBe(digest(created.token));
    const listed = await caller.tokens.list();
    expect(JSON.stringify(listed)).not.toContain(created.token);
    expect(listed.results[0]).not.toHaveProperty("digest");
    expect(await caller.tokens.get({ id: created.id })).not.toHaveProperty(
      "token",
    );
    expect(
      (
        await f.rpc(
          "tokens.create",
          { name: "Legacy", scopes: ["write"], projects: [] },
          "mutation",
        )
      ).status,
    ).toBe(400);
    await Promise.resolve(
      expect(
        caller.tokens.create({
          name: "Foreign",
          scopes: ["catalog:read"],
          projects: [f.foreignProject.id],
        }),
      ).rejects.toThrow("Not found"),
    );
    await Promise.resolve(
      expect(
        caller.tokens.create({
          name: "Foreign",
          scopes: ["actions:run"],
          action_versions: [f.foreignSaved.version.id],
        }),
      ).rejects.toThrow("Not found"),
    );
    await Promise.resolve(
      expect(f.foreignCaller.tokens.get({ id: created.id })).rejects.toThrow(
        "Not found",
      ),
    );
    await Promise.resolve(
      expect(f.caller(created.token).tokens.list()).rejects.toThrow(
        "requires a browser session",
      ),
    );
    await Promise.resolve(
      expect(f.caller(created.token).schedules.list()).rejects.toThrow(
        "requires a browser session",
      ),
    );
    await Promise.resolve(
      expect(f.caller(created.token).webhooks.list()).rejects.toThrow(
        "requires a browser session",
      ),
    );
    await Promise.resolve(
      expect(f.caller(created.token).audit.list()).rejects.toThrow(
        "requires a browser session",
      ),
    );
    await Promise.resolve(
      expect(
        f.foreignCaller.tokens.revoke({ id: created.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" }),
    );
    expect((await caller.tokens.get({ id: created.id })).revoked).toBe(false);
    await Promise.resolve(
      expect(
        caller.tokens.revoke({ id: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" }),
    );
    await caller.tokens.revoke({ id: created.id });
    expect((await caller.tokens.get({ id: created.id })).revoked).toBe(true);
    expect(
      (await f.rpc("projects.list", undefined, "query", created.token)).status,
    ).toBe(401);
  } finally {
    f.close();
  }
});

test("audit filters preserve workspace isolation and redact former member identity", async () => {
  const f = await automationFixture();
  try {
    const caller = f.caller();
    const token = await caller.tokens.create({
      name: "Audited",
      scopes: ["catalog:read"],
    });
    const listed = await caller.audit.list({
      kind: "token.created",
      object_id: token.id,
      actor: f.user.id,
      since: "2000-01-01T00:00:00.000Z",
      before: "2100-01-01T00:00:00.000Z",
    });
    expect(listed.results).toHaveLength(1);
    const record = listed.results[0]!;
    expect(record.actor_id).toBe(f.user.id);
    expect(record.actor_label).toBe(f.user.username);
    expect(
      await f.foreignCaller.audit.list({ object_id: token.id }),
    ).toMatchObject({ count: 0, results: [] });
    await Promise.resolve(
      expect(f.foreignCaller.audit.get({ id: record.id })).rejects.toThrow(
        "Not found",
      ),
    );
    expect(
      (
        await f.rpc("audit.list", {
          since: "2100-01-01T00:00:00.000Z",
          before: "2000-01-01T00:00:00.000Z",
        })
      ).status,
    ).toBe(400);
    const former = f.store.db
      .insert(users)
      .values({
        username: "former",
        email: "former@example.test",
        passwordHash: "fixture hash",
      })
      .returning()
      .get();
    const membership = f.store.db
      .insert(memberships)
      .values({
        workspaceId: f.workspace.id,
        userId: former.id,
        role: "member",
      })
      .returning()
      .get();
    const formerRecord = f.store.db
      .insert(auditRecords)
      .values({
        id: crypto.randomUUID(),
        workspaceId: f.workspace.id,
        actorId: former.id,
        action: "action.created",
        resource: "retired",
        createdAt: f.time,
        updatedAt: f.time,
      })
      .returning()
      .get();
    await caller.workspace.removeMember({ id: membership.id });
    expect(await caller.audit.get({ id: formerRecord.id })).toMatchObject({
      actor_id: null,
      actor_label: "Former workspace member",
    });
  } finally {
    f.close();
  }
});

test("failed audit writes roll back schedule, webhook, and token mutations", async () => {
  const f = await automationFixture();
  try {
    const caller = f.caller();
    const before = f.store.db.select().from(auditRecords).all().length;
    f.store.sqlite.exec(
      "CREATE TEMP TRIGGER fail_control_audit BEFORE INSERT ON audit_records BEGIN SELECT RAISE(ABORT, 'audit write unavailable'); END",
    );
    await Promise.resolve(
      expect(
        caller.tokens.create({ name: "Rollback", scopes: ["catalog:read"] }),
      ).rejects.toThrow(),
    );
    await Promise.resolve(
      expect(
        caller.schedules.create({
          action: f.saved.action,
          cron: "* * * * *",
          inputs: { value: 1 },
        }),
      ).rejects.toThrow(),
    );
    await Promise.resolve(
      expect(
        caller.webhooks.create({ name: "Rollback", action: f.saved.action }),
      ).rejects.toThrow(),
    );
    expect((await caller.tokens.list()).count).toBe(0);
    expect((await caller.schedules.list()).count).toBe(0);
    expect((await caller.webhooks.list()).count).toBe(0);
    expect(f.store.db.select().from(auditRecords).all()).toHaveLength(before);
    const response = await f.rpc(
      "tokens.create",
      { name: "Private failure", scopes: ["catalog:read"] },
      "mutation",
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("audit write unavailable");
  } finally {
    f.close();
  }
});
