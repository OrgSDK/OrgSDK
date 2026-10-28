import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auditRecords, credentials, plugins } from "../db/schema";
import { oauthAttempts } from "../db/schema/oauth";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/responses";
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
export async function finish(
  ctx: AppContext,
  fetcher: Fetcher,
): Promise<Response> {
  const workspace = authorize(ctx),
    user = ctx.user!;
  const params = new URL(ctx.request.url).searchParams;
  if (params.has("error"))
    throw new HttpError(
      400,
      "Authorization was declined. Return to Plugins to try again.",
    );
  const state = field(params.get("state"), 500),
    code = field(params.get("code"), 4000);
  const attempt = ctx.store.sqlite
    .transaction(() => {
      const record = ctx.store.db
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
      )
        throw new HttpError(
          400,
          "This connection request has expired or belongs to another session.",
        );
      ctx.store.db
        .delete(oauthAttempts)
        .where(eq(oauthAttempts.stateDigest, record.stateDigest))
        .run();
      return record;
    })
    .immediate();
  const payload = JSON.parse(
    decrypt(ctx.store, attempt.encryptedPayload),
  ) as Payload;
  if (!provider(payload.provider))
    throw new HttpError(400, "Invalid OAuth provider.");
  const fields: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: payload.redirect_uri,
  };
  if (providers[payload.provider].pkce) fields.code_verifier = payload.verifier;
  const tokens = await tokenExchange(
    payload.provider,
    payload.secret_clientId,
    payload.secret_clientSecret,
    fields,
    fetcher,
  );
  ctx.store.sqlite
    .transaction(() => {
      const session = identityRepository(ctx.store).session(ctx.sessionId!);
      const plugin = ctx.store.db
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
      )
        throw new HttpError(
          403,
          "Your session or workspace access changed. Restart the connection.",
        );
      if (
        !plugin ||
        plugin.digest !== payload.pluginDigest ||
        plugin.version !== payload.pluginVersion
      )
        throw new HttpError(
          400,
          "The plugin changed during authorization. Restart the connection.",
        );
      const current = checkedMetadata(plugin);
      if (
        current.provider !== payload.provider ||
        JSON.stringify(current.scopes) !== JSON.stringify(payload.scopes)
      )
        throw new HttpError(
          400,
          "Plugin authorization changed. Restart the connection.",
        );
      const credentialId = randomUUID(),
        timestamp = new Date().toISOString();
      const secret = applyTokens(
        {
          secret_clientId: payload.secret_clientId,
          secret_clientSecret: payload.secret_clientSecret,
          source: "byo",
          scopes: payload.scopes,
        },
        tokens,
      );
      ctx.store.db
        .insert(credentials)
        .values({
          id: credentialId,
          workspaceId: workspace.id,
          name: payload.name,
          provider: payload.provider,
          encryptedSecret: encrypt(ctx.store, JSON.stringify(secret)),
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      ctx.store.db
        .update(plugins)
        .set({ credentialId, updatedAt: timestamp })
        .where(eq(plugins.id, plugin.id))
        .run();
      ctx.store.db
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
    })
    .immediate();
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/plugins/",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
