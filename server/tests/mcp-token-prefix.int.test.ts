import { expect, expectTypeOf, test } from "bun:test";
import { accessTokens } from "../db/schema";
import { base } from "../shared/records";
import { digest, randomSecret } from "../shared/security";
import type { mcpAccessTokenDigest } from "../tokens/access-token";
import { rpcFixture } from "./rpc-fixture";

test("MCP and tRPC require the prefix even for a stored legacy token and a valid browser cookie", async () => {
  const fixture = rpcFixture();
  try {
    const secret = randomSecret();
    const legacy = fixture.store.db
      .insert(accessTokens)
      .values({
        ...base(fixture.workspace.id),
        actorId: fixture.user.id,
        name: "Existing client",
        scopes: ["catalog:read"],
        projects: [fixture.project.id],
        digest: digest(secret),
      })
      .returning()
      .get();
    const mcp = (token: string) =>
      fixture.request(
        "/mcp/",
        "POST",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        },
        token,
      );
    const trpc = (token: string) =>
      fixture.rpc("projects.list", undefined, "query", token);

    for (const request of [mcp, trpc]) {
      for (const invalid of [
        secret,
        `orgsdk_executor_${secret}`,
        "orgsdk_mcp_",
        `orgsdk_mcp_${secret}!`,
      ]) {
        const response = await request(invalid);
        expect(response.status).toBe(401);
        const error = await response.text();
        expect(error).toContain("orgsdk_mcp_");
        expect(error).not.toContain(secret);
      }
      const unknown = await request(`orgsdk_mcp_${randomSecret()}`);
      expect(unknown.status).toBe(401);
      expect(await unknown.text()).toContain("Invalid OrgSDK access token.");
      expect((await request(`orgsdk_mcp_${secret}`)).status).toBe(200);
    }
    expect(await fixture.caller().tokens.get({ id: legacy.id })).toMatchObject({
      mcp_request_count: 1,
      trpc_request_count: 1,
    });
    await fixture.caller().tokens.revoke({ id: legacy.id });
    expect((await mcp(`orgsdk_mcp_${secret}`)).status).toBe(401);
  } finally {
    fixture.close();
  }
});

test("token lookup requires a prefixed credential at compile time", () => {
  type TokenInput = Parameters<typeof mcpAccessTokenDigest>[0];
  expectTypeOf<string>().not.toExtend<TokenInput>();
  expectTypeOf<`orgsdk_executor_${string}`>().not.toExtend<TokenInput>();
});
