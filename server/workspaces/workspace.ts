import { eq } from "drizzle-orm";
import { invitations, workspaces } from "../db/schema/core";
import {
  type AppContext,
  requireManager,
  requireUser,
  requireWorkspace,
} from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { memberRows } from "./queries";
import { serializeInvite } from "./views";
export async function handleWorkspaceInfo(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  requireUser(ctx);
  const workspace = requireWorkspace(ctx);
  if (path === "/api/v1/workspaces/" && method === "GET")
    return json([
      {
        id: workspace.id,
        name: workspace.name,
        role: ctx.role,
        is_active: true,
      },
    ]);
  if (path === "/api/v1/workspaces/" && method === "POST")
    throw new HttpError(403, "Workspace provisioning is operator-managed.");
  if (path === "/api/v1/workspaces/current/") {
    if (method === "GET")
      return json({
        workspace: { id: workspace.id, name: workspace.name },
        role: ctx.role,
        members: memberRows(ctx),
        invitations: ["owner", "admin"].includes(ctx.role!)
          ? db
              .select()
              .from(invitations)
              .where(eq(invitations.workspaceId, workspace.id))
              .all()
              .map(serializeInvite)
          : [],
      });
    if (method === "PATCH") {
      requireManager(ctx);
      const body = await input(ctx.request);
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 100
      )
        throw new HttpError(400, "Enter a valid name.");
      const updated = db
        .update(workspaces)
        .set({ name: body.name.trim() })
        .where(eq(workspaces.id, workspace.id))
        .returning()
        .get();
      return json({ id: updated.id, name: updated.name });
    }
  }
  if (/^\/api\/v1\/workspaces\/\d+\/select\/$/.test(path) && method === "POST")
    throw new HttpError(403, "Use the workspace domain to select a workspace.");
  return null;
}
