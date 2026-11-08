import { auth, discoverOAuthServerInfo } from "@modelcontextprotocol/client";
import { browserSessionManagerProcedure } from "../../procedures";
import { oauthAttempts } from "../../../db/schema";
import { inTransaction } from "../../../db/transaction";
import { mcpConnection } from "../../../mcp/connections";
import { oauthBeginSchema } from "../../../mcp/schemas";
import { oauthProvider, type OAuthState } from "../../../mcp/oauth-state";
import { checkOAuthDestination } from "../../../mcp/oauth-destination";
import { oauthFetch } from "../../../mcp/oauth-network";
import { assertCurrentPluginManager } from "../../../plugins/validation";
import { digest, encrypt, randomSecret } from "../../../shared/security";
import { ServiceError } from "../../../shared/errors";
import { callbackOrigin } from "../../../oauth/providers";

export const beginOAuthProcedure = browserSessionManagerProcedure
  .input(oauthBeginSchema)
  .mutation(async ({ ctx, input }) => {
    const connection = mcpConnection(ctx, input.id);
    if (connection.authMode !== "oauth") {
      throw new ServiceError(
        "BAD_REQUEST",
        "Select OAuth in connection settings first.",
      );
    }
    const state: OAuthState = {
      endpoint: connection.endpoint,
      plugin: input.id,
      revision: connection.revision,
      redirectUri: new URL(
        "/oauth/mcp/callback",
        callbackOrigin(ctx),
      ).toString(),
      state: randomSecret(),
      ...(input.client_metadata_url
        ? { clientMetadataUrl: input.client_metadata_url }
        : {}),
    };
    const fetchFn = oauthFetch(
      connection.endpoint,
      connection.candidate?.resourceMetadata,
    );
    const discovery = await discoverOAuthServerInfo(connection.endpoint, {
      fetchFn,
    });
    state.discovery = discovery;
    if (input.client_id) {
      state.client = {
        client_id: input.client_id,
        issuer:
          discovery.authorizationServerMetadata?.issuer ??
          discovery.authorizationServerUrl,
        ...(input.client_secret ? { client_secret: input.client_secret } : {}),
      };
    }
    await auth(oauthProvider(state), {
      serverUrl: connection.endpoint,
      fetchFn,
    });
    if (!state.authorizationUrl) {
      throw new ServiceError(
        "BAD_REQUEST",
        "This server did not provide an authorization link.",
      );
    }
    await checkOAuthDestination(state.authorizationUrl, connection.endpoint);
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      if (
        mcpConnection(transaction, input.id).revision !== connection.revision
      ) {
        throw new ServiceError(
          "CONFLICT",
          "The connection changed. Restart authorization.",
        );
      }
      transaction.db
        .insert(oauthAttempts)
        .values({
          stateDigest: digest(state.state),
          userId: ctx.user.id,
          workspaceId: ctx.workspace.id,
          pluginId: input.id,
          sessionId: ctx.sessionId,
          encryptedPayload: encrypt(ctx, JSON.stringify(state)),
          expiresAt: Date.now() + 600_000,
        })
        .run();
    });
    return { authorization_url: state.authorizationUrl };
  });
