import { eq } from "drizzle-orm";
import { memberships, users } from "../db/schema/core";
import { type AppContext, requireWorkspace } from "../http/context";
export function memberRows(ctx: AppContext) {
  const db = ctx.store.db;
  const workspace = requireWorkspace(ctx);
  return db
    .select({
      id: memberships.id,
      user_id: users.id,
      email: users.email,
      username: users.username,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspace.id))
    .all();
}
