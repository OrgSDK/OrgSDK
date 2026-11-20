import { auth } from "@modelcontextprotocol/client";
import { and, eq } from "drizzle-orm";
import type { AppDependencies } from "../application";
import { credentials } from "../db/schema";
import { decrypt, encrypt } from "../shared/security";
import { oauthProvider, oauthStateSchema } from "./oauth-state";
import { oauthFetch } from "./oauth-network";
import { ServiceError } from "../shared/errors";
import { recordSecretVersion } from "../oauth/refresh";

const refreshes = new WeakMap<
  AppDependencies["db"],
  Map<string, Promise<Record<string, unknown>>>
>();
export async function mcpExecutionSecret(
  ctx: AppDependencies,
  credential: typeof credentials.$inferSelect,
) {
  let pending = refreshes.get(ctx.db);
  if (!pending) {
    pending = new Map();
    refreshes.set(ctx.db, pending);
  }
  const current = pending.get(credential.id);
  if (current) {
    return current;
  }
  const operation = refresh(ctx, credential);
  pending.set(credential.id, operation);
  try {
    return await operation;
  } finally {
    pending.delete(credential.id);
  }
}
async function refresh(
  ctx: AppDependencies,
  initial: typeof credentials.$inferSelect,
) {
  const credential = ctx.db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.id, initial.id),
        eq(credentials.workspaceId, initial.workspaceId),
      ),
    )
    .get();
  if (!credential) {
    throw new ServiceError("NOT_FOUND", "Reconnect this MCP server.");
  }
  const state = oauthStateSchema.parse(
    JSON.parse(decrypt(ctx, credential.encryptedSecret)),
  );
  let revision = credential;
  if (!state.tokens || (state.expiresAt ?? 0) <= Date.now() + 60_000) {
    if (!state.tokens?.refresh_token) {
      throw new ServiceError(
        "BAD_REQUEST",
        "MCP sign-in expired. Reconnect from project plugins.",
      );
    }
    const result = await auth(oauthProvider(state), {
      serverUrl: state.endpoint,
      fetchFn: oauthFetch(state.endpoint),
    });
    if (result !== "AUTHORIZED") {
      throw new ServiceError(
        "BAD_REQUEST",
        "MCP sign-in expired. Reconnect from project plugins.",
      );
    }
    const updated = ctx.db
      .update(credentials)
      .set({
        encryptedSecret: encrypt(ctx, JSON.stringify(state)),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(credentials.id, credential.id),
          eq(credentials.encryptedSecret, credential.encryptedSecret),
        ),
      )
      .returning()
      .get();
    if (!updated) {
      throw new ServiceError(
        "CONFLICT",
        "MCP credential changed during refresh. Retry the run.",
      );
    }
    revision = updated;
  }
  if (!state.tokens || state.tokens.token_type.toLowerCase() !== "bearer") {
    throw new ServiceError("BAD_REQUEST", "Reconnect this MCP server.");
  }
  return recordSecretVersion(
    {
      expires_at: state.expiresAt,
      headers: { Authorization: `Bearer ${state.tokens.access_token}` },
    },
    revision,
  );
}
