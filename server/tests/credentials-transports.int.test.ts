import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { credentialSchema } from "../credentials/schemas";
import { auditRecords, credentials } from "../db/schema";
import { credentialFixture, credentialInput } from "./credentials-fixture";

test("HTTP and direct tRPC credentials share validation, encrypted persistence and public views", async () => {
  const fixture = credentialFixture();
  try {
    const response = await fixture.rpc(
      "credentials.create",
      credentialInput,
      "mutation",
    );
    expect(response.status).toBe(200);
    const raw: unknown = await response.json();
    const created = z
      .object({ result: z.object({ data: credentialSchema }) })
      .parse(raw).result.data;
    expect(created).toEqual({
      id: created.id,
      name: "Test API",
      provider: "test",
    });
    const stored = fixture.store.db.select().from(credentials).get()!;
    expect(stored.encryptedSecret).not.toContain(
      credentialInput.secret.api_key,
    );
    expect(
      JSON.parse(fixture.store.secrets.decrypt(stored.encryptedSecret)),
    ).toEqual(credentialInput.secret);

    const caller = fixture.caller();
    expect(await caller.get({ id: created.id })).toEqual(created);
    expect((await caller.list()).results).toEqual([created]);
    await caller.update({ id: created.id, name: "Renamed" });
    expect(
      fixture.store.db.select().from(credentials).get()!.encryptedSecret,
    ).toBe(stored.encryptedSecret);

    const replacement = {
      nested: { token: "synthetic-replacement" },
      enabled: true,
      count: 3,
      nullable: null,
    };
    const updated = await fixture.rpc(
      "credentials.update",
      { id: created.id, secret: replacement },
      "mutation",
    );
    expect(updated.status).toBe(200);
    expect(
      JSON.parse(
        fixture.store.secrets.decrypt(
          fixture.store.db.select().from(credentials).get()!.encryptedSecret,
        ),
      ),
    ).toEqual(replacement);
    const rpc = await fixture.rpc("credentials.get", { id: created.id });
    expect(rpc.status).toBe(200);
    expect(
      z
        .object({ result: z.object({ data: credentialSchema }) })
        .parse(await rpc.json()).result.data.name,
    ).toBe("Renamed");

    const mutation = await fixture.rpc(
      "credentials.create",
      {
        ...credentialInput,
        name: "RPC created",
      },
      "mutation",
    );
    expect(mutation.status).toBe(200);
    const rpcCreated = z
      .object({ result: z.object({ data: credentialSchema }) })
      .parse(await mutation.json()).result.data;
    expect(
      (await fixture.rpc("credentials.get", { id: rpcCreated.id })).status,
    ).toBe(200);
    await caller.delete({ id: rpcCreated.id });
    expect(
      (await fixture.rpc("credentials.get", { id: rpcCreated.id })).status,
    ).toBe(404);

    expect(
      (await fixture.rpc("credentials.delete", { id: created.id }, "mutation"))
        .status,
    ).toBe(200);
    await Promise.resolve(
      expect(caller.get({ id: created.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      }),
    );
    const audit = fixture.store.db
      .select()
      .from(auditRecords)
      .where(eq(auditRecords.resource, created.id))
      .all();
    expect(audit.map((entry) => entry.action)).toEqual([
      "credential.created",
      "credential.updated",
      "credential.updated",
      "credential.deleted",
    ]);
    expect(JSON.stringify(audit)).not.toContain("synthetic-");
    expect(fixture.context()).not.toHaveProperty("store");
    expect(fixture.context()).not.toHaveProperty("sqlite");
  } finally {
    fixture.close();
  }
});

test("invalid credentials are rejected by HTTP and direct tRPC before writing", async () => {
  const fixture = credentialFixture();
  try {
    const invalidInputs = [
      { ...credentialInput, secret: {} },
      { ...credentialInput, secret: [] },
      { ...credentialInput, secret: null },
      { ...credentialInput, secret: "token" },
      { ...credentialInput, secret: { value: "é".repeat(16_000) } },
      { ...credentialInput, name: " " },
      { ...credentialInput, provider: 42 },
      { ...credentialInput, encryptedSecret: "supplied-by-client" },
    ];
    for (const input of invalidInputs) {
      expect(
        (await fixture.rpc("credentials.create", input, "mutation")).status,
      ).toBe(400);
    }
    expect(fixture.store.db.select().from(credentials).all()).toEqual([]);
    expect(fixture.store.db.select().from(auditRecords).all()).toEqual([]);
    expect(
      (await fixture.rpc("credentials.get", { id: "invalid-id" })).status,
    ).toBe(400);
    expect((await fixture.rpc("credentials.list", {}, "mutation")).status).toBe(
      405,
    );
  } finally {
    fixture.close();
  }
});
