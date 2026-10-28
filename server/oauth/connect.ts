import { and, eq, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { plugins } from "../db/schema";
import { oauthAttempts } from "../db/schema/oauth";
import type { AppContext } from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { digest, encrypt, randomSecret } from "../shared/security";
import {
  type Payload,
  authorize,
  callbackOrigin,
  checkedMetadata,
  field,
  isCurrentManager,
  providers,
} from "./providers";
export async function begin(ctx: AppContext): Promise<Response> {
  const workspace = authorize(ctx),
    user = ctx.user!;
  const body = await input(ctx.request);
  const pluginId = field(body.plugin, 100),
    name = field(body.name, 100),
    clientId = field(body.client_id, 500),
    clientSecret = field(body.client_secret, 2000);
  const plugin = ctx.store.db
    .select()
    .from(plugins)
    .where(and(eq(plugins.id, pluginId), eq(plugins.workspaceId, workspace.id)))
    .get();
  if (!plugin)
    throw new HttpError(
      400,
      "Choose an installed external plugin in this workspace.",
    );
  const auth = checkedMetadata(plugin);
  const state = randomSecret(),
    verifier = randomSecret();
  const callback = new URL(
    "/api/v1/credentials/oauth-callback/",
    callbackOrigin(ctx),
  ).toString();
  const payload: Payload = {
    secret_clientId: clientId,
    secret_clientSecret: clientSecret,
    source: "byo",
    provider: auth.provider,
    name,
    redirect_uri: callback,
    verifier,
    scopes: auth.scopes,
    pluginDigest: plugin.digest,
    pluginVersion: plugin.version,
  };
  ctx.store.sqlite
    .transaction(() => {
      if (!isCurrentManager(ctx, workspace.id, user.id))
        throw new HttpError(
          403,
          "Only workspace owners and admins can manage connections.",
        );
      ctx.store.db
        .delete(oauthAttempts)
        .where(lt(oauthAttempts.expiresAt, Date.now()))
        .run();
      ctx.store.db
        .insert(oauthAttempts)
        .values({
          stateDigest: digest(state),
          userId: user.id,
          workspaceId: workspace.id,
          pluginId,
          sessionId: ctx.sessionId!,
          encryptedPayload: encrypt(ctx.store, JSON.stringify(payload)),
          expiresAt: Date.now() + 600000,
        })
        .run();
    })
    .immediate();
  const authorization = new URL(providers[auth.provider].authorization);
  const query = authorization.searchParams;
  query.set("client_id", clientId);
  query.set("redirect_uri", callback);
  query.set("response_type", "code");
  query.set("scope", auth.scopes.join(" "));
  query.set("state", state);
  if (providers[auth.provider].pkce) {
    query.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    query.set("code_challenge_method", "S256");
  }
  if (auth.provider === "google-oauth") {
    query.set("access_type", "offline");
    query.set("prompt", "consent");
  }
  return json({ authorization_url: authorization.toString() });
}
