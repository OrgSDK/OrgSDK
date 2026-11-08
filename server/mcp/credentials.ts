import { and, eq, like } from "drizzle-orm";
import type { ServiceContext } from "../application";
import { credentials } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";

/**
 * Delete a connection-owned credential that an update, reconnect or removal
 * replaced. Only `mcp-*` providers can be removed; ordinary credentials are
 * never touched even if they are referenced unexpectedly.
 */
export function discardMcpCredential(
  ctx: ServiceContext,
  credentialId: string | null,
) {
  if (!credentialId) {
    return;
  }
  ctx.db
    .delete(credentials)
    .where(
      and(
        eq(credentials.workspaceId, requireWorkspace(ctx).id),
        eq(credentials.id, credentialId),
        like(credentials.provider, "mcp-%"),
      ),
    )
    .run();
}
