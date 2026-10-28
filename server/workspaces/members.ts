import { and, eq } from "drizzle-orm";
import { assertCurrentUser } from "../auth/sessions";
import { memberships } from "../db/schema/core";
import {
  type AppContext,
  requireUser,
  requireWorkspace,
} from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { memberRows } from "./queries";
export async function handleMembers(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  const user = requireUser(ctx);
  const workspace = requireWorkspace(ctx);
  const memberMatch = path.match(/^\/api\/v1\/workspaces\/members\/(\d+)\/$/);
  if (memberMatch) {
    const id = Number(memberMatch[1]);
    const body = method === "PATCH" ? await input(ctx.request) : {};
    return ctx.store.sqlite
      .transaction(() => {
        assertCurrentUser(ctx, user);
        const actor = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, workspace.id),
              eq(memberships.userId, user.id),
            ),
          )
          .get();
        const target = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.id, id),
              eq(memberships.workspaceId, workspace.id),
            ),
          )
          .get();
        if (!actor || !target) throw new HttpError(404, "Member not found.");
        if (target.role === "owner")
          throw new HttpError(
            400,
            "Transfer ownership before removing or changing the owner.",
          );
        if (method === "DELETE" && target.userId === user.id) {
          db.delete(memberships).where(eq(memberships.id, id)).run();
          return new Response(null, { status: 204 });
        }
        if (
          !["owner", "admin"].includes(actor.role) ||
          (actor.role === "admin" && target.role !== "member")
        )
          throw new HttpError(403, "Only the owner can manage admins.");
        if (method === "DELETE") {
          db.delete(memberships).where(eq(memberships.id, id)).run();
          return new Response(null, { status: 204 });
        }
        if (method === "PATCH") {
          if (actor.role !== "owner")
            throw new HttpError(403, "Only the owner can change roles.");
          if (!["admin", "member"].includes(body.role))
            throw new HttpError(400, "Invalid role.");
          db.update(memberships)
            .set({ role: body.role })
            .where(eq(memberships.id, id))
            .run();
          return json(memberRows(ctx).find((row) => row.id === id));
        }
        throw new HttpError(405, "Method not allowed.");
      })
      .immediate();
  }
  if (path === "/api/v1/workspaces/ownership/" && method === "POST") {
    const body = await input(ctx.request);
    return ctx.store.sqlite
      .transaction(() => {
        assertCurrentUser(ctx, user);
        const actor = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, workspace.id),
              eq(memberships.userId, user.id),
            ),
          )
          .get();
        if (actor?.role !== "owner")
          throw new HttpError(403, "Only the owner can transfer ownership.");
        const target = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.id, Number(body.membership_id)),
              eq(memberships.workspaceId, workspace.id),
            ),
          )
          .get();
        if (!target || target.id === actor.id)
          throw new HttpError(400, "Select another member as owner.");
        db.update(memberships)
          .set({ role: "admin" })
          .where(eq(memberships.id, actor.id))
          .run();
        db.update(memberships)
          .set({ role: "owner" })
          .where(eq(memberships.id, target.id))
          .run();
        return new Response(null, { status: 204 });
      })
      .immediate();
  }
  return null;
}
