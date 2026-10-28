import { browserProcedure } from "../procedures";
import { requireIdentityWorkspace } from "../../auth/context";
import { memberRows, listInvitations } from "../../workspaces/queries";
import { serializeInvite } from "../../workspaces/views";
export const currentProcedure = browserProcedure.query(({ ctx }) => {
  const workspace = requireIdentityWorkspace(ctx);
  return {
    workspace: { id: workspace.id, name: workspace.name },
    role: ctx.role,
    members: memberRows(ctx.db, workspace.id),
    invitations: ["owner", "admin"].includes(ctx.role!)
      ? listInvitations(ctx.db, workspace.id).map(serializeInvite)
      : [],
  };
});
