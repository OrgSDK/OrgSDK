import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assertCurrentUser } from "../auth/sessions";
import { validEmail } from "../auth/validation";
import { invitations, memberships } from "../db/schema/core";
import {
  type AppContext,
  requireManager,
  requireUser,
  requireWorkspace,
} from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { smtpConfigured } from "../mail/outbox";
import { enqueueMail, revokeUnsentMail } from "../repositories/mail-outbox";
import { now } from "../shared/records";
import { digest, encrypt } from "../shared/security";
import { memberRows } from "./queries";
import { serializeInvite } from "./views";
export async function handleInvitations(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  const user = requireUser(ctx);
  const workspace = requireWorkspace(ctx);
  const inviteMatch = path.match(
    /^\/api\/v1\/workspaces\/invitations\/(\d+)\/$/,
  );
  if (path === "/api/v1/workspaces/invitations/" && method === "POST") {
    requireManager(ctx);
    if (!smtpConfigured())
      throw new HttpError(503, "Invitation delivery is not configured.");
    const body = await input(ctx.request);
    if (!validEmail(body.email) || !["admin", "member"].includes(body.role))
      throw new HttpError(400, "Enter a valid email and role.");
    const email = body.email.trim().toLowerCase();
    const token = randomUUID();
    const timestamp = now();
    const url = new URL("/workspaces/invite/", ctx.request.url);
    url.searchParams.set("token", token);
    const message = encrypt(
      ctx.store,
      `You have been invited to ${workspace.name} as ${body.role}.\nSign in with ${email} and accept: ${url}\nThis invitation expires in seven days.`,
    );
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
        if (!actor || !["owner", "admin"].includes(actor.role))
          throw new HttpError(
            403,
            "Only workspace owners and admins can invite members.",
          );
        if (actor.role !== "owner" && body.role === "admin")
          throw new HttpError(403, "Only the owner can invite admins.");
        if (
          memberRows(ctx).some((member) => member.email.toLowerCase() === email)
        )
          throw new HttpError(
            400,
            "This email already belongs to a workspace member.",
          );
        const prior = db
          .select()
          .from(invitations)
          .where(eq(invitations.workspaceId, workspace.id))
          .all()
          .filter(
            (invite) =>
              invite.email.toLowerCase() === email &&
              !invite.acceptedAt &&
              !invite.revokedAt,
          );
        for (const invite of prior) {
          if (invite.expiresAt > timestamp)
            throw new HttpError(400, "A pending invitation already exists.");
          db.update(invitations)
            .set({ revokedAt: timestamp })
            .where(eq(invitations.id, invite.id))
            .run();
        }
        const invite = db
          .insert(invitations)
          .values({
            workspaceId: workspace.id,
            email,
            role: body.role,
            tokenDigest: digest(token),
            expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          })
          .returning()
          .get();
        enqueueMail(ctx.store, {
          id: "invitation:" + invite.id,
          recipient: email,
          subject: "Invitation to " + workspace.name,
          body: message,
        });
        return json(serializeInvite(invite), 201);
      })
      .immediate();
  }
  if (inviteMatch && method === "DELETE") {
    requireManager(ctx);
    const invitation = db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.id, Number(inviteMatch[1])),
          eq(invitations.workspaceId, workspace.id),
        ),
      )
      .get();
    if (!invitation) throw new HttpError(404, "Invitation not found.");
    if (ctx.role !== "owner" && invitation.role === "admin")
      throw new HttpError(403, "Only the owner can revoke admin invitations.");
    ctx.store.sqlite
      .transaction(() => {
        db.update(invitations)
          .set({ revokedAt: now() })
          .where(eq(invitations.id, invitation.id))
          .run();
        revokeUnsentMail(ctx.store, "invitation:" + invitation.id);
      })
      .immediate();
    return new Response(null, { status: 204 });
  }
  return null;
}
