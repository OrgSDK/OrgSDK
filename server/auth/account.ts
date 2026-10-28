import { eq, or } from "drizzle-orm";
import { sessions, users } from "../db/schema/core";
import { type AppContext, requireUser } from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { assertCurrentUser, requireFresh, rotateSession } from "./sessions";
import { throttle } from "./throttle";
import { strongPassword, validEmail } from "./validation";
import { authBody, authError } from "./views";
export async function handleAccount(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  if (path === "/account/password/change" && method === "POST") {
    const user = requireUser(ctx);
    requireFresh(ctx);
    const body = await input(ctx.request);
    throttle(ctx, `password:${user.id}`);
    if (
      typeof body.current_password !== "string" ||
      !(await Bun.password.verify(body.current_password, user.passwordHash))
    )
      return authError("Invalid current password.");
    if (!strongPassword(body.new_password))
      return authError("Choose a stronger password.");
    const passwordHash = await Bun.password.hash(body.new_password);
    rotateSession(
      ctx,
      user.id,
      null,
      () => {
        assertCurrentUser(ctx, user);
        requireFresh(ctx);
      },
      () => {
        db.update(users)
          .set({ passwordHash })
          .where(eq(users.id, user.id))
          .run();
        db.delete(sessions)
          .where(
            or(
              eq(sessions.userId, user.id),
              eq(sessions.pendingUserId, user.id),
            ),
          )
          .run();
      },
    );
    return json(authBody(ctx));
  }
  if (path === "/account/email") {
    const user = requireUser(ctx);
    if (method === "GET")
      return json({
        status: 200,
        data: [{ email: user.email, primary: true, verified: false }],
      });
    if (method === "POST") {
      requireFresh(ctx);
      const body = await input(ctx.request);
      if (!validEmail(body.email))
        return authError("Enter a valid email address.");
      const email = body.email.trim().toLowerCase();
      try {
        ctx.store.sqlite
          .transaction(() => {
            assertCurrentUser(ctx, user);
            requireFresh(ctx);
            db.update(users).set({ email }).where(eq(users.id, user.id)).run();
          })
          .immediate();
      } catch (error) {
        if (error instanceof HttpError) throw error;
        return authError("This email is already in use.");
      }
      return json({
        status: 200,
        data: [{ email, primary: true, verified: false }],
      });
    }
  }
  return null;
}
