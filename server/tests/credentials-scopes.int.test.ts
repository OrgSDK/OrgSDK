import { expect, test } from "bun:test";
import { accessTokens } from "../db/schema";
import { base } from "../shared/records";
import { digest } from "../shared/security";
import { credentialFixture, credentialInput } from "./credentials-fixture";

test("credential procedures reject every bearer token regardless of stored scope family", async () => {
  const fixture = credentialFixture();
  try {
    function issueToken(scopes: string[]) {
      const secret = crypto.randomUUID();
      fixture.store.db
        .insert(accessTokens)
        .values({
          ...base(fixture.workspace.id),
          actorId: fixture.user.id,
          name: "Scope test",
          digest: digest(secret),
          scopes,
        })
        .run();
      return secret;
    }
    const clientToken = issueToken(["catalog:read", "actions:write"]);
    const readToken = issueToken(["read"]);
    const writeToken = issueToken(["write"]);
    const created = await fixture.caller().create(credentialInput);
    for (const token of [clientToken, readToken, writeToken]) {
      expect(
        (await fixture.rpc("credentials.list", undefined, "query", token))
          .status,
      ).toBe(403);
      expect(
        (
          await fixture.rpc(
            "credentials.create",
            credentialInput,
            "mutation",
            token,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await fixture.rpc(
            "credentials.update",
            { id: created.id, name: "Denied" },
            "mutation",
            token,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await fixture.rpc(
            "credentials.delete",
            { id: created.id },
            "mutation",
            token,
          )
        ).status,
      ).toBe(403);
    }
    expect((await fixture.caller().get({ id: created.id })).name).toBe(
      "Test API",
    );
  } finally {
    fixture.close();
  }
});
