import { and, eq } from "drizzle-orm";
import { invitations, memberships } from "../db/schema/core";
import { type AppContext, requireUser } from "../http/context";
import { HttpError, json } from "../http/responses";
import { now } from "../shared/records";
import { digest } from "../shared/security";
export async function handleInvitationAccept(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  const user = requireUser(ctx);
  const accept = path.match(
    /^\/api\/v1\/workspaces\/invitations\/([^/]+)\/accept\/$/,
  );
  if (accept && method === "POST")
    return ctx.store.sqlite
      .transaction(() => {
        const invite = db
          .select()
          .from(invitations)
          .where(eq(invitations.tokenDigest, digest(accept[1]!)))
          .get();
        if (
          !invite ||
          !ctx.workspace ||
          invite.workspaceId !== ctx.workspace.id
        )
          throw new HttpError(404, "Invitation not found.");
        if (invite.email.toLowerCase() !== user.email.toLowerCase())
          throw new HttpError(403, "Sign in with the invited email address.");
        if (invite.revokedAt || invite.expiresAt <= now())
          throw new HttpError(
            400,
            "This invitation has expired or was revoked.",
          );
        const existing = db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, invite.workspaceId),
              eq(memberships.userId, user.id),
            ),
          )
          .get();
        if (invite.acceptedAt && !existing)
          throw new HttpError(400, "This invitation has already been used.");
        if (!existing)
          db.insert(memberships)
            .values({
              workspaceId: invite.workspaceId,
              userId: user.id,
              role: invite.role,
            })
            .run();
        if (!invite.acceptedAt)
          db.update(invitations)
            .set({ acceptedAt: now() })
            .where(eq(invitations.id, invite.id))
            .run();
        return json({ id: ctx.workspace.id, name: ctx.workspace.name });
      })
      .immediate();
  return null;
}
