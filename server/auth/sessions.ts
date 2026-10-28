import { eq } from "drizzle-orm";
import { sessions, type users } from "../db/schema/core";
import { type AppContext, requireUser, setCookie } from "../http/context";
import { HttpError } from "../http/responses";
import { identityRepository } from "../repositories/identity";
import { digest, randomSecret } from "../shared/security";
export function rotateSession(
  ctx: AppContext,
  userId: number | null,
  pendingUserId: number | null = null,
  guard?: () => void,
  mutation?: () => void,
) {
  const secret = randomSecret();
  const id = digest(secret);
  const time = Date.now();
  ctx.store.sqlite
    .transaction(() => {
      guard?.();
      mutation?.();
      if (ctx.sessionId)
        ctx.store.db
          .delete(sessions)
          .where(eq(sessions.id, ctx.sessionId))
          .run();
      ctx.store.db
        .insert(sessions)
        .values({
          id,
          userId,
          pendingUserId,
          workspaceId: ctx.workspace?.id ?? null,
          expiresAt: time + (pendingUserId ? 5 * 60000 : 14 * 86400000),
          reauthenticatedAt: userId ? time : null,
        })
        .run();
    })
    .immediate();
  ctx.sessionId = id;
  setCookie(ctx, "sessionid", secret, true);
  setCookie(ctx, "csrftoken", randomSecret());
}

export function requireFresh(ctx: AppContext) {
  requireUser(ctx);
  const session = ctx.sessionId
    ? identityRepository(ctx.store).session(ctx.sessionId)
    : undefined;
  if (
    !session?.reauthenticatedAt ||
    session.userId !== ctx.user?.id ||
    session.expiresAt <= Date.now() ||
    session.reauthenticatedAt < Date.now() - 300000
  )
    throw new HttpError(401, "Confirm your identity to continue.");
}

export function assertCurrentUser(
  ctx: AppContext,
  user: typeof users.$inferSelect,
  withSession = true,
) {
  const current = identityRepository(ctx.store).user(user.id);
  if (
    !current ||
    current.passwordHash !== user.passwordHash ||
    current.email !== user.email ||
    current.totpSecret !== user.totpSecret
  )
    throw new HttpError(401, "Your account changed. Sign in again.");
  if (withSession) {
    const session = ctx.sessionId
      ? identityRepository(ctx.store).session(ctx.sessionId)
      : undefined;
    if (
      !session ||
      session.userId !== user.id ||
      session.expiresAt <= Date.now()
    )
      throw new HttpError(401, "Your session has expired. Sign in again.");
  }
}

export function markFresh(ctx: AppContext, user: typeof users.$inferSelect) {
  ctx.store.sqlite
    .transaction(() => {
      assertCurrentUser(ctx, user);
      ctx.store.db
        .update(sessions)
        .set({ reauthenticatedAt: Date.now() })
        .where(eq(sessions.id, ctx.sessionId!))
        .run();
    })
    .immediate();
}
