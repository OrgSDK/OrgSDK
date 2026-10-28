import { type AppContext } from "../http/context";
import { handleAccount } from "./account";
import { handleAuthenticators } from "./authenticators";
import { handleLogin } from "./login";
import { handleReauthentication } from "./reauthentication";
import { handleAuthSession } from "./session-route";
export async function handleHeadless(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  return (
    (await handleAuthSession(ctx, path, method)) ??
    (await handleLogin(ctx, path, method)) ??
    (await handleReauthentication(ctx, path, method)) ??
    (await handleAccount(ctx, path, method)) ??
    (await handleAuthenticators(ctx, path, method))
  );
}
