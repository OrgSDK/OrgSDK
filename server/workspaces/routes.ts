import { type AppContext } from "../http/context";
import { handleInvitationAccept } from "./accept-invitation";
import { handleInvitations } from "./invitations";
import { handleMembers } from "./members";
import { handleWorkspaceInfo } from "./workspace";
export async function handleWorkspace(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  return (
    (await handleInvitationAccept(ctx, path, method)) ??
    (await handleWorkspaceInfo(ctx, path, method)) ??
    (await handleMembers(ctx, path, method)) ??
    (await handleInvitations(ctx, path, method))
  );
}
