import { createHash } from "node:crypto";
import { inTransaction } from "../../db/transaction";
import { oauthQueries } from "../../oauth/queries";
import { oauthConnectSchema } from "../../oauth/schemas";
import {
  type Payload,
  authorize,
  callbackOrigin,
  checkedMetadata,
  field,
  isCurrentManager,
  providers,
} from "../../oauth/providers";
import { ServiceError } from "../../shared/errors";
import { digest, encrypt, randomSecret } from "../../shared/security";
import { protectedProcedure } from "../procedures";
export const beginOAuthProcedure = protectedProcedure
  .input(oauthConnectSchema)
  .mutation(({ ctx, input }) => {
    const workspace = authorize(ctx);
    const user = ctx.user!;
    const pluginId = field(input.plugin, 100);
    const name = field(input.name, 100);
    const clientId = field(input.client_id, 500);
    const clientSecret = field(input.client_secret, 2000);
    const plugin = oauthQueries(ctx.db, workspace.id).installedPlugin(pluginId);
    if (!plugin) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Choose an installed external plugin in this workspace.",
      );
    }
    const auth = checkedMetadata(plugin);
    const state = randomSecret();
    const verifier = randomSecret();
    const callback = new URL("/oauth/callback", callbackOrigin(ctx)).toString();
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
    inTransaction(ctx, (ctx) => {
      if (!isCurrentManager(ctx, workspace.id, user.id)) {
        throw new ServiceError(
          "FORBIDDEN",
          "Only workspace owners and admins can manage connections.",
        );
      }
      const queries = oauthQueries(ctx.db, workspace.id);
      queries.removeExpiredAttempts();
      queries.createAttempt({
        stateDigest: digest(state),
        userId: user.id,
        pluginId,
        sessionId: ctx.sessionId!,
        encryptedPayload: encrypt(ctx, JSON.stringify(payload)),
        expiresAt: Date.now() + 600000,
      });
    });
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
    return { authorization_url: authorization.toString() };
  });
