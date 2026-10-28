import { memberships } from "../db/schema/core";
import { rpcFixture } from "./rpc-fixture";
export function credentialFixture() {
  const fixture = rpcFixture();
  return {
    ...fixture,
    caller: (token?: string) => fixture.caller(token).credentials,
    membership: fixture.store.db.select().from(memberships).get()!,
  };
}
export const credentialInput = {
  name: "  Test API  ",
  provider: "test",
  secret: { api_key: "synthetic-credential-test-secret" },
};
