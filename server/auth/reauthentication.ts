import { type AppContext, requireUser } from "../http/context";
import { input, json } from "../http/responses";
import { markFresh } from "./sessions";
import { throttle } from "./throttle";
import { consumeCode } from "./totp";
import { authBody, authError } from "./views";
export async function handleReauthentication(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  if (path === "/auth/reauthenticate" && method === "POST") {
    const user = requireUser(ctx);
    const body = await input(ctx.request);
    throttle(ctx, `reauth:${user.id}`);
    if (
      typeof body.password !== "string" ||
      !(await Bun.password.verify(body.password, user.passwordHash))
    )
      return authError("Invalid password.");
    if (user.totpSecret)
      return authError(
        "Use your authenticator code to confirm your identity.",
        401,
      );
    markFresh(ctx, user);
    return json(authBody(ctx));
  }
  if (path === "/auth/2fa/reauthenticate" && method === "POST") {
    const user = requireUser(ctx);
    const body = await input(ctx.request);
    throttle(ctx, `reauth-mfa:${user.id}`);
    if (!consumeCode(ctx, user, String(body.code ?? "")))
      return authError("Invalid authentication code.");
    markFresh(ctx, user);
    return json(authBody(ctx));
  }
  return null;
}
