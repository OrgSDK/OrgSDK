import { expect, test } from "bun:test";
import { openStore } from "../db";
import { accessTokens } from "../db/schema";
import {
  initialStore,
  seedWorkspace,
  temporaryDatabase,
} from "./database-fixture";

test("generated transport migration renames the request metric without losing activity", () => {
  const fixture = temporaryDatabase();
  try {
    const previous = initialStore(fixture.directory, 2);
    const { workspace, user, time } = seedWorkspace(previous);
    // Exercise the actual prior generated schema; current Drizzle models target the new column.
    previous.sqlite
      .query(
        `INSERT INTO access_tokens
      (id,workspace_id,actor_id,name,digest,scopes,request_count,rest_request_count,mcp_request_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        crypto.randomUUID(),
        workspace.id,
        user.id,
        "Activity",
        "test-digest",
        '["catalog:read"]',
        17,
        12,
        5,
        time,
        time,
      );
    previous.close();
    const current = openStore(fixture.directory);
    try {
      const token = current.db.select().from(accessTokens).get()!;
      expect(token.requestCount).toBe(17);
      expect(token.trpcRequestCount).toBe(12);
      expect(token.mcpRequestCount).toBe(5);
      expect(token.scopes).toEqual(["catalog:read"]);
    } finally {
      current.close();
    }
  } finally {
    fixture.cleanup();
  }
});
