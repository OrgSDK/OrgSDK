import type { OAuthCallbackInput } from "./schemas";
import { inTransaction } from "../db/transaction";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auditRecords, credentials, plugins } from "../db/schema";
import { oauthAttempts } from "../db/schema/oauth";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { identityRepository } from "../repositories/identity";
import { decrypt, digest, encrypt } from "../shared/security";
import {
  type Fetcher,
  type Payload,
  authorize,
  checkedMetadata,
  field,
  isCurrentManager,
  provider,
  providers,
} from "./providers";
import { applyTokens, tokenExchange } from "./tokens";
export async function finishOAuth(
  ctx: ServiceContext,
  input: OAuthCallbackInput,
  fetcher: Fetcher = fetch,
) {
  const workspace = authorize(ctx);
  const user = ctx.user!;
  if (input.error !== undefined) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Authorization was declined. Return to Plugins to try again.",
    );
  }
  const state = field(input.state, 500);
  const code = field(input.code, 4000);
  const attempt = inTransaction(ctx, (ctx) => {
    const record = ctx.db
      .select()
      .from(oauthAttempts)
      .where(eq(oauthAttempts.stateDigest, digest(state)))
      .get();
    if (
      !record ||
      record.userId !== user.id ||
      record.workspaceId !== workspace.id ||
      record.sessionId !== ctx.sessionId ||
      record.expiresAt <= Date.now() ||
      !isCurrentManager(ctx, workspace.id, user.id)
    ) {
      throw new ServiceError(
        "BAD_REQUEST",
        "This connection request has expired or belongs to another session.",
      );
    }
    ctx.db
      .delete(oauthAttempts)
      .where(eq(oauthAttempts.stateDigest, record.stateDigest))
      .run();
    return record;
  });
  const payload = JSON.parse(decrypt(ctx, attempt.encryptedPayload)) as Payload;
  if (!provider(payload.provider)) {
    throw new ServiceError("BAD_REQUEST", "Invalid OAuth provider.");
  }
  const fields: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: payload.redirect_uri,
  };
  if (providers[payload.provider].pkce) {
    fields.code_verifier = payload.verifier;
  }
  const tokens = await tokenExchange(
    payload.provider,
    payload.secret_clientId,
    payload.secret_clientSecret,
    fields,
    fetcher,
  );
  inTransaction(ctx, (ctx) => {
    const session = identityRepository(ctx.db).session(ctx.sessionId!);
    const plugin = ctx.db
      .select()
      .from(plugins)
      .where(
        and(
          eq(plugins.id, attempt.pluginId),
          eq(plugins.workspaceId, workspace.id),
        ),
      )
      .get();
    if (
      !session ||
      session.userId !== user.id ||
      session.expiresAt <= Date.now() ||
      !isCurrentManager(ctx, workspace.id, user.id)
    ) {
      throw new ServiceError(
        "FORBIDDEN",
        "Your session or workspace access changed. Restart the connection.",
      );
    }
    if (
      !plugin ||
      plugin.digest !== payload.pluginDigest ||
      plugin.version !== payload.pluginVersion
    ) {
      throw new ServiceError(
        "BAD_REQUEST",
        "The plugin changed during authorization. Restart the connection.",
      );
    }
    const current = checkedMetadata(plugin);
    if (
      current.provider !== payload.provider ||
      JSON.stringify(current.scopes) !== JSON.stringify(payload.scopes)
    ) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Plugin authorization changed. Restart the connection.",
      );
    }
    const credentialId = randomUUID();
    const timestamp = new Date().toISOString();
    const secret = applyTokens(
      {
        secret_clientId: payload.secret_clientId,
        secret_clientSecret: payload.secret_clientSecret,
        source: "byo",
        scopes: payload.scopes,
      },
      tokens,
    );
    ctx.db
      .insert(credentials)
      .values({
        id: credentialId,
        workspaceId: workspace.id,
        name: payload.name,
        provider: payload.provider,
        encryptedSecret: encrypt(ctx, JSON.stringify(secret)),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    ctx.db
      .update(plugins)
      .set({ credentialId, updatedAt: timestamp })
      .where(eq(plugins.id, plugin.id))
      .run();
    ctx.db
      .insert(auditRecords)
      .values({
        id: randomUUID(),
        workspaceId: workspace.id,
        actorId: user.id,
        action: "credential.connected",
        resource: credentialId,
        data: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  });
  return { location: "/plugins/" };
}
