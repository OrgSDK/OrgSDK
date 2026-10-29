import { and, eq, lt } from "drizzle-orm";
import { oauthAttempts, plugins } from "../../db/schema";
import { createHash } from "node:crypto";
import { inTransaction } from "../../db/transaction";
import { oauthConnectSchema } from "../../oauth/schemas";
import {
  type Payload,
  callbackOrigin,
  checkedMetadata,
  field,
  isCurrentManager,
  providers,
} from "../../oauth/providers";
import { ServiceError } from "../../shared/errors";
import { digest, encrypt, randomSecret } from "../../shared/security";
import { browserSessionManagerProcedure } from "../procedures";
export const beginOAuthProcedure = browserSessionManagerProcedure
  .input(oauthConnectSchema)
  .mutation(({ ctx, input }) => {
    const workspace = ctx.workspace;
    const user = ctx.user;
    const pluginId = field(input.plugin, 100);
    const name = field(input.name, 100);
    const clientId = field(input.client_id, 500);
    const clientSecret = field(input.client_secret, 2000);
    const plugin = ctx.db
      .select()
      .from(plugins)
      .where(
        and(eq(plugins.id, pluginId), eq(plugins.workspaceId, workspace.id)),
      )
      .get();
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
      ctx.db
        .delete(oauthAttempts)
        .where(
          and(
            eq(oauthAttempts.workspaceId, workspace.id),
            lt(oauthAttempts.expiresAt, Date.now()),
          ),
        )
        .run();
      ctx.db
        .insert(oauthAttempts)
        .values({
          workspaceId: workspace.id,
          stateDigest: digest(state),
          userId: user.id,
          pluginId,
          sessionId: ctx.sessionId,
          encryptedPayload: encrypt(ctx, JSON.stringify(payload)),
          expiresAt: Date.now() + 600000,
        })
        .run();
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
