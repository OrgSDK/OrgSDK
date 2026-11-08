import { auth } from "@modelcontextprotocol/client";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ServiceContext } from "../application";
import {
  oauthAttempts,
  plugins,
  credentials,
  mcpConnections,
} from "../db/schema";
import { inTransaction } from "../db/transaction";
import { requireManager, requireUser } from "../shared/authorization";
import { assertCurrentPluginManager } from "../plugins/validation";
import { mcpConnection, cancelConnectionRuns } from "./connections";
import { discardMcpCredential } from "./credentials";
import { oauthProvider, oauthStateSchema } from "./oauth-state";
import { oauthFetch } from "./oauth-network";
import { decrypt, digest, encrypt } from "../shared/security";
import { base } from "../shared/records";
import { ServiceError } from "../shared/errors";
import { recordAudit } from "../repositories/audit";

export const callbackSchema = z.object({
  state: z.string().max(500),
  code: z.string().max(4000).optional(),
  iss: z.string().max(2000).optional(),
  error: z.string().optional(),
});
export async function finishMcpOAuth(
  ctx: ServiceContext,
  input: z.infer<typeof callbackSchema>,
) {
  const workspace = requireManager(ctx);
  const user = requireUser(ctx);
  const attempt = inTransaction(ctx, (transaction) => {
    assertCurrentPluginManager(transaction);
    const row = transaction.db
      .select()
      .from(oauthAttempts)
      .where(
        and(
          eq(oauthAttempts.stateDigest, digest(input.state)),
          eq(oauthAttempts.workspaceId, workspace.id),
        ),
      )
      .get();
    if (
      !row ||
      row.userId !== user.id ||
      row.sessionId !== ctx.sessionId ||
      row.expiresAt <= Date.now()
    ) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Authorization expired or belongs to another browser session.",
      );
    }
    transaction.db
      .delete(oauthAttempts)
      .where(eq(oauthAttempts.stateDigest, row.stateDigest))
      .run();
    return row;
  });
  if (input.error || !input.code) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Authorization was declined. Reconnect from project plugins.",
    );
  }
  const state = oauthStateSchema.parse(
    JSON.parse(decrypt(ctx, attempt.encryptedPayload)),
  );
  const connection = mcpConnection(ctx, attempt.pluginId);
  if (
    state.plugin !== connection.pluginId ||
    state.revision !== connection.revision ||
    state.endpoint !== connection.endpoint
  ) {
    throw new ServiceError(
      "CONFLICT",
      "Connection changed. Restart authorization.",
    );
  }
  await auth(oauthProvider(state), {
    serverUrl: state.endpoint,
    authorizationCode: input.code,
    ...(input.iss ? { iss: input.iss } : {}),
    fetchFn: oauthFetch(state.endpoint),
  });
  if (!state.tokens || state.tokens.token_type.toLowerCase() !== "bearer") {
    throw new ServiceError(
      "BAD_REQUEST",
      "This server requires an unsupported token type.",
    );
  }
  return inTransaction(ctx, (transaction) => {
    assertCurrentPluginManager(transaction);
    if (mcpConnection(transaction, state.plugin).revision !== state.revision) {
      throw new ServiceError(
        "CONFLICT",
        "Connection changed. Restart authorization.",
      );
    }
    cancelConnectionRuns(transaction, state.plugin);
    const previousCredential = transaction.db
      .select({ credentialId: plugins.credentialId })
      .from(plugins)
      .where(eq(plugins.id, state.plugin))
      .get();
    const credential = transaction.db
      .insert(credentials)
      .values({
        ...base(workspace.id),
        name: "MCP connection",
        provider: "mcp-oauth",
        encryptedSecret: encrypt(ctx, JSON.stringify(state)),
      })
      .returning()
      .get();
    const plugin = transaction.db
      .update(plugins)
      .set({ credentialId: credential.id, enabled: false })
      .where(eq(plugins.id, state.plugin))
      .returning({ project: plugins.projectId })
      .get();
    transaction.db
      .update(mcpConnections)
      .set({
        status: "unchecked",
        candidate: null,
        revision: state.revision + 1,
        catalogue: [],
        enabledTools: [],
        discoveryRunId: null,
      })
      .where(eq(mcpConnections.pluginId, state.plugin))
      .run();
    discardMcpCredential(transaction, previousCredential?.credentialId ?? null);
    recordAudit(transaction, "plugin", state.plugin, "credential.connected");
    return plugin;
  });
}
