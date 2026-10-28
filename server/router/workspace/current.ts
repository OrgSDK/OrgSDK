import { browserWorkspaceProcedure } from "../procedures";
import { memberQuery } from "../../workspaces/queries";
import { eq } from "drizzle-orm";
import { invitations } from "../../db/schema/core";
import { serializeInvite } from "../../workspaces/views";
export const currentProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const workspace = ctx.workspace;
  return {
    workspace: { id: workspace.id, name: workspace.name },
    role: ctx.role,
    members: memberQuery(ctx.db, workspace.id).all(),
    invitations:
      ctx.role && ["owner", "admin"].includes(ctx.role)
        ? ctx.db
            .select()
            .from(invitations)
            .where(eq(invitations.workspaceId, workspace.id))
            .all()
            .map(serializeInvite)
        : [],
  };
});
