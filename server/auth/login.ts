import { users } from "../db/schema/core";
import { type AppContext } from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { identityRepository } from "../repositories/identity";
import { randomSecret } from "../shared/security";
import { assertCurrentUser, rotateSession } from "./sessions";
import { throttle } from "./throttle";
import { consumeCode } from "./totp";
import { strongPassword, validEmail } from "./validation";
import { authBody, authError } from "./views";
export let dummyPasswordHash: Promise<string> | undefined;

export async function handleLogin(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  if (path === "/auth/login" && method === "POST") {
    const body = await input(ctx.request);
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    throttle(ctx, `login:${email}`);
    const user = identityRepository(ctx.store).userByEmail(email);
    dummyPasswordHash ??= Bun.password.hash(randomSecret());
    const supplied =
      typeof body.password === "string" && body.password.length <= 1024
        ? body.password
        : "";
    const valid = await Bun.password.verify(
      supplied,
      user?.passwordHash ?? (await dummyPasswordHash),
    );
    if (!user || !valid) return authError("Invalid email or password.");
    if (!ctx.workspace) return authError("Invalid email or password.");
    if (user.totpSecret) {
      rotateSession(ctx, null, user.id, () =>
        assertCurrentUser(ctx, user, false),
      );
      ctx.user = null;
      return json(authBody(ctx, ["mfa_authenticate"]), 401);
    }
    rotateSession(ctx, user.id, null, () =>
      assertCurrentUser(ctx, user, false),
    );
    ctx.user = user;
    return json(authBody(ctx));
  }
  if (path === "/auth/2fa/authenticate" && method === "POST") {
    const session = ctx.sessionId
      ? identityRepository(ctx.store).session(ctx.sessionId)
      : undefined;
    const user = session?.pendingUserId
      ? identityRepository(ctx.store).user(session.pendingUserId)
      : undefined;
    const body = await input(ctx.request);
    throttle(ctx, `mfa:${session?.pendingUserId ?? "anonymous"}`);
    if (!user || !consumeCode(ctx, user, String(body.code ?? "")))
      return authError("Invalid authentication code.");
    if (!ctx.workspace) return authError("Invalid authentication code.");
    rotateSession(ctx, user.id, null, () => {
      const current = ctx.sessionId
        ? identityRepository(ctx.store).session(ctx.sessionId)
        : undefined;
      if (
        !current ||
        current.pendingUserId !== user.id ||
        current.expiresAt <= Date.now()
      )
        throw new HttpError(401, "Your session has expired. Sign in again.");
      assertCurrentUser(ctx, user, false);
    });
    ctx.user = user;
    return json(authBody(ctx));
  }
  if (path === "/auth/signup" && method === "POST") {
    if (!ctx.workspace) return authError("Unregistered workspace.", 404);
    const body = await input(ctx.request);
    if (
      !validEmail(body.email) ||
      typeof body.username !== "string" ||
      !body.username.trim() ||
      body.username.length > 150 ||
      !strongPassword(body.password)
    )
      return authError("Provide a valid email, username and strong password.");
    const email = body.email.trim().toLowerCase();
    throttle(ctx, `signup:${email}`);
    if (identityRepository(ctx.store).userByEmail(email))
      return authError("This email is already in use.");
    const passwordHash = await Bun.password.hash(body.password);
    try {
      const user = db
        .insert(users)
        .values({ email, username: body.username.trim(), passwordHash })
        .returning()
        .get();
      rotateSession(ctx, user.id);
      ctx.user = user;
      return json(authBody(ctx));
    } catch {
      return authError("This email or username is already in use.");
    }
  }
  return null;
}
