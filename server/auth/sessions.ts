import { inTransaction } from "../db/transaction";
import { eq } from "drizzle-orm";
import { sessions, type users } from "../db/schema/core";
import { type ServiceContext } from "../application";
import { type IdentityContext, requireIdentity } from "./context";
import { ServiceError } from "../shared/errors";
import { identityRepository } from "../repositories/identity";
import { digest, randomSecret } from "../shared/security";
export function rotateSession(
  ctx: IdentityContext,
  userId: number | null,
  pendingUserId: number | null = null,
  guard?: () => void,
  mutation?: () => void,
) {
  const secret = randomSecret();
  const id = digest(secret);
  const time = Date.now();
  inTransaction(ctx, (ctx) => {
    guard?.();
    mutation?.();
    if (ctx.sessionId) {
      ctx.db.delete(sessions).where(eq(sessions.id, ctx.sessionId)).run();
    }
    ctx.db
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
  });
  ctx.sessionId = id;
  ctx.sessionChanged(secret);
}

export function requireFresh(ctx: ServiceContext) {
  requireIdentity(ctx);
  const session = ctx.sessionId
    ? identityRepository(ctx.db).session(ctx.sessionId)
    : undefined;
  if (
    !session?.reauthenticatedAt ||
    session.userId !== ctx.user?.id ||
    session.expiresAt <= Date.now() ||
    session.reauthenticatedAt < Date.now() - 300000
  ) {
    throw new ServiceError(
      "UNAUTHORIZED",
      "Confirm your identity to continue.",
    );
  }
}

export function assertCurrentUser(
  ctx: ServiceContext,
  user: typeof users.$inferSelect,
  withSession = true,
) {
  const current = identityRepository(ctx.db).user(user.id);
  if (
    !current ||
    current.passwordHash !== user.passwordHash ||
    current.email !== user.email ||
    current.totpSecret !== user.totpSecret
  ) {
    throw new ServiceError(
      "UNAUTHORIZED",
      "Your account changed. Sign in again.",
    );
  }
  if (withSession) {
    const session = ctx.sessionId
      ? identityRepository(ctx.db).session(ctx.sessionId)
      : undefined;
    if (
      !session ||
      session.userId !== user.id ||
      session.expiresAt <= Date.now()
    ) {
      throw new ServiceError(
        "UNAUTHORIZED",
        "Your session has expired. Sign in again.",
      );
    }
  }
}

export function markFresh(
  ctx: ServiceContext,
  user: typeof users.$inferSelect,
) {
  inTransaction(ctx, (ctx) => {
    assertCurrentUser(ctx, user);
    ctx.db
      .update(sessions)
      .set({ reauthenticatedAt: Date.now() })
      .where(eq(sessions.id, ctx.sessionId!))
      .run();
  });
}
