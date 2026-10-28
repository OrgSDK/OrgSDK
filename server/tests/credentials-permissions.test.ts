import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { appRouter } from "../router";
import { auditRecords, credentials, plugins } from "../db/schema";
import { memberships, workspaces } from "../db/schema/core";
import { base } from "../shared/records";
import { credentialFixture, credentialInput } from "./credentials-fixture";

test("credential permissions and workspace scope match across HTTP and direct tRPC", async () => {
  const fixture = credentialFixture();
  try {
    const created = await fixture.caller().create(credentialInput);
    const foreignWorkspace = fixture.store.db
      .insert(workspaces)
      .values({ name: "Other", host: "other.local", createdAt: fixture.time })
      .returning()
      .get();
    const foreign = fixture.store.db
      .insert(credentials)
      .values({
        ...base(foreignWorkspace.id),
        name: "Foreign",
        provider: "test",
        encryptedSecret: fixture.store.secrets.encrypt("{}"),
      })
      .returning()
      .get();
    const caller = fixture.caller();
    expect(
      (await caller.list()).results.map((credential) => credential.id),
    ).toEqual([created.id]);
    for (const operation of ["get", "update", "delete"]) {
      expect(
        (
          await fixture.rpc(
            `credentials.${operation}`,
            operation === "update"
              ? { id: foreign.id, name: "Changed" }
              : { id: foreign.id },
            operation === "get" ? "query" : "mutation",
          )
        ).status,
      ).toBe(404);
    }
    await Promise.resolve(
      expect(caller.get({ id: foreign.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      }),
    );
    await Promise.resolve(
      expect(
        caller.update({ id: foreign.id, name: "Changed" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" }),
    );
    await Promise.resolve(
      expect(caller.delete({ id: foreign.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      }),
    );
    expect(fixture.store.db.select().from(auditRecords).all()).toHaveLength(1);

    fixture.store.db
      .update(memberships)
      .set({ role: "member" })
      .where(eq(memberships.id, fixture.membership.id))
      .run();
    expect((await fixture.rpc("credentials.list")).status).toBe(200);
    expect(
      (await fixture.rpc("credentials.create", credentialInput, "mutation"))
        .status,
    ).toBe(403);
    await Promise.resolve(
      expect(fixture.caller().create(credentialInput)).rejects.toMatchObject({
        code: "FORBIDDEN",
      }),
    );
    await Promise.resolve(
      expect(
        fixture.caller().update({ id: created.id, name: "Changed" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" }),
    );
    await Promise.resolve(
      expect(fixture.caller().delete({ id: created.id })).rejects.toMatchObject(
        { code: "FORBIDDEN" },
      ),
    );
    await Promise.resolve(
      expect(
        appRouter
          .createCaller({ ...fixture.context(), user: null })
          .credentials.list(),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" }),
    );
  } finally {
    fixture.close();
  }
});

test("credentials in use cannot be deleted and audit failure rolls back every mutation", async () => {
  const fixture = credentialFixture();
  try {
    const caller = fixture.caller();
    const created = await caller.create(credentialInput);
    const plugin = fixture.store.db
      .insert(plugins)
      .values({
        ...base(fixture.workspace.id),
        projectId: fixture.project.id,
        slug: "test",
        version: "1",
        digest: "test",
        credentialId: created.id,
      })
      .returning()
      .get();
    expect(
      (await fixture.rpc("credentials.delete", { id: created.id }, "mutation"))
        .status,
    ).toBe(409);
    await Promise.resolve(
      expect(caller.delete({ id: created.id })).rejects.toMatchObject({
        code: "CONFLICT",
      }),
    );
    expect(fixture.store.db.select().from(auditRecords).all()).toHaveLength(1);
    fixture.store.db
      .update(plugins)
      .set({ credentialId: null })
      .where(eq(plugins.id, plugin.id))
      .run();

    const missingActor = appRouter.createCaller({
      ...fixture.context(),
      user: { ...fixture.user, id: -1 },
      userId: -1,
    }).credentials;
    await Promise.resolve(
      expect(
        missingActor.create({ ...credentialInput, name: "Rolled back" }),
      ).rejects.toThrow(),
    );
    await Promise.resolve(
      expect(
        missingActor.update({ id: created.id, name: "Rolled back" }),
      ).rejects.toThrow(),
    );
    await Promise.resolve(
      expect(missingActor.delete({ id: created.id })).rejects.toThrow(),
    );
    expect(fixture.store.db.select().from(credentials).all()).toHaveLength(1);
    expect((await caller.get({ id: created.id })).name).toBe("Test API");
    expect(fixture.store.db.select().from(auditRecords).all()).toHaveLength(1);
    await caller.delete({ id: created.id });
    expect(fixture.store.db.select().from(credentials).all()).toEqual([]);
  } finally {
    fixture.close();
  }
});
