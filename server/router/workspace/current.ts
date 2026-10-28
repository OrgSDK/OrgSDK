import { browserWorkspaceProcedure } from "../procedures";
import { memberRows, listInvitations } from "../../workspaces/queries";
import { serializeInvite } from "../../workspaces/views";
export const currentProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const workspace = ctx.workspace;
  return {
    workspace: { id: workspace.id, name: workspace.name },
    role: ctx.role,
    members: memberRows(ctx.db, workspace.id),
    invitations:
      ctx.role && ["owner", "admin"].includes(ctx.role)
        ? listInvitations(ctx.db, workspace.id).map(serializeInvite)
        : [],
  };
});
