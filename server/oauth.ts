import { createHash, randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Store } from "./db";
import { oauthAttempts } from "./db/oauth";
import { credentials, plugins, auditRecords } from "./db/domain";
import { memberships } from "./db/core";
import type { AppContext } from "./context";
import { requireManager } from "./context";
import { decrypt, digest, encrypt, randomSecret } from "./security";
import { HttpError, input, json } from "./http";

const providers = {
  "google-oauth": {
    authorization: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    pkce: true,
  },
  "twitter-oauth": {
    authorization: "https://twitter.com/i/oauth2/authorize",
    token: "https://api.twitter.com/2/oauth2/token",
    pkce: true,
  },
  "linkedin-oauth": {
    authorization: "https://www.linkedin.com/oauth/v2/authorization",
    token: "https://www.linkedin.com/oauth/v2/accessToken",
    pkce: false,
  },
  "facebook-oauth": {
    authorization: "https://www.facebook.com/v21.0/dialog/oauth",
    token: "https://graph.facebook.com/v21.0/oauth/access_token",
    pkce: false,
  },
} as const;
type Provider = keyof typeof providers;
type Credential = typeof credentials.$inferSelect;
type Fetcher = typeof fetch;
type Payload = {
  secret_clientId: string;
  secret_clientSecret: string;
  source: "byo";
  provider: Provider;
  name: string;
  redirect_uri: string;
  verifier: string;
  scopes: string[];
  pluginDigest: string;
  pluginVersion: string;
};
function provider(value: unknown): value is Provider {
  return typeof value === "string" && Object.hasOwn(providers, value);
}
function field(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, "Provide valid connection settings.");
  return value.trim();
}
function callbackOrigin(ctx: AppContext): string {
  const value = process.env.ORGSDK_PUBLIC_ORIGIN;
  if (!value)
    throw new HttpError(
      503,
      "Set ORGSDK_PUBLIC_ORIGIN to this workspace’s public origin before connecting OAuth.",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(503, "ORGSDK_PUBLIC_ORIGIN is invalid.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname.toLowerCase() !== ctx.workspace?.host
  )
    throw new HttpError(
      503,
      "ORGSDK_PUBLIC_ORIGIN must match the registered workspace host and use HTTPS (or local HTTP).",
    );
  return url.origin;
}
function authorize(ctx: AppContext) {
  if (ctx.token || !ctx.sessionId)
    throw new HttpError(403, "OAuth connections require a browser session.");
  return requireManager(ctx);
}
function checkedMetadata(plugin: typeof plugins.$inferSelect) {
  const release = plugin.releaseMetadata;
  const auth = release?.auth;
  if (
    plugin.distribution !== "external" ||
    release?.slug !== plugin.slug ||
    release?.version !== plugin.version ||
    release?.digest !== plugin.digest ||
    release?.package_url !== plugin.packageUrl ||
    auth?.type !== "oauth2" ||
    !provider(auth.provider) ||
    !Array.isArray(auth.scopes) ||
    auth.scopes.length > 100 ||
    auth.scopes.some(
      (scope: unknown) =>
        typeof scope !== "string" ||
        !scope ||
        scope.length > 500 ||
        /[\s\x00-\x1f]/.test(scope),
    )
  )
    throw new HttpError(
      400,
      "Choose an installed OAuth plugin with a valid pinned catalog release.",
    );
  return {
    provider: auth.provider as Provider,
    scopes: auth.scopes as string[],
  };
}
function isCurrentManager(
  ctx: AppContext,
  workspaceId: number,
  userId: number,
) {
  const member = ctx.store.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.userId, userId),
      ),
    )
    .get();
  return member && ["owner", "admin"].includes(member.role);
}
async function begin(ctx: AppContext): Promise<Response> {
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
type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};
async function tokenExchange(
  providerName: Provider,
  clientId: string,
  clientSecret: string,
  params: Record<string, string>,
  fetcher: Fetcher,
): Promise<Tokens> {
  const fields = new URLSearchParams({ ...params, client_id: clientId });
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  });
  if (providerName === "twitter-oauth")
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    );
  else fields.set("client_secret", clientSecret);
  try {
    const response = await fetcher(providers[providerName].token, {
      method: "POST",
      headers,
      body: fields,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok || !response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(item.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      typeof value.access_token !== "string" ||
      !value.access_token ||
      value.access_token.length > 32000 ||
      (value.refresh_token !== undefined &&
        (typeof value.refresh_token !== "string" ||
          value.refresh_token.length > 32000)) ||
      (value.scope !== undefined &&
        (typeof value.scope !== "string" || value.scope.length > 10000))
    )
      throw new Error();
    const seconds = Number(value.expires_in ?? 3600);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 315360000)
      throw new Error();
    return {
      access_token: value.access_token,
      expires_in: seconds,
      ...(value.refresh_token ? { refresh_token: value.refresh_token } : {}),
      ...(value.scope ? { scope: value.scope } : {}),
    };
  } catch {
    throw new HttpError(
      400,
      "OAuth token exchange failed. Check the app settings and reconnect.",
    );
  }
}
function applyTokens(payload: Record<string, any>, tokens: Tokens) {
  payload.secret_accessToken = tokens.access_token;
  payload.expires_at = Date.now() / 1000 + (tokens.expires_in ?? 3600);
  if (tokens.refresh_token) payload.secret_refreshToken = tokens.refresh_token;
  if (tokens.scope) payload.scopes = tokens.scope.split(/\s+/).filter(Boolean);
  return payload;
}
async function finish(ctx: AppContext, fetcher: Fetcher): Promise<Response> {
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
      const session = ctx.store.sqlite
        .query("SELECT user_id,expires_at FROM sessions WHERE id=?")
        .get(ctx.sessionId!) as { user_id: number; expires_at: number } | null;
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
        session.user_id !== user.id ||
        session.expires_at <= Date.now() ||
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
export async function handleOAuth(
  ctx: AppContext,
  fetcher: Fetcher = fetch,
): Promise<Response | null> {
  const path = new URL(ctx.request.url).pathname;
  if (
    path === "/api/v1/credentials/oauth-connect/" &&
    ctx.request.method === "POST"
  )
    return begin(ctx);
  if (
    path === "/api/v1/credentials/oauth-callback/" &&
    ctx.request.method === "GET"
  )
    return finish(ctx, fetcher);
  return null;
}
const refreshes = new Map<string, Promise<Record<string, unknown>>>();
const secretVersions = new WeakMap<
  Record<string, unknown>,
  { id: string; workspaceId: number; provider: string; encryptedSecret: string }
>();
function recordSecretVersion(
  secret: Record<string, unknown>,
  credential: Credential,
) {
  secretVersions.set(secret, {
    id: credential.id,
    workspaceId: credential.workspaceId,
    provider: credential.provider,
    encryptedSecret: credential.encryptedSecret,
  });
  return secret;
}
export function assertExecutionSecretCurrent(
  store: Store,
  credential: Credential,
  secret: Record<string, unknown>,
): void {
  const version = secretVersions.get(secret);
  const current = store.db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.id, credential.id),
        eq(credentials.workspaceId, credential.workspaceId),
      ),
    )
    .get();
  if (
    !version ||
    !current ||
    version.id !== current.id ||
    version.workspaceId !== current.workspaceId ||
    version.provider !== current.provider ||
    version.encryptedSecret !== current.encryptedSecret
  )
    throw new HttpError(
      409,
      "Credential changed during execution. Retry the run.",
    );
}
export async function executionSecret(
  store: Store,
  credential: Credential,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>> {
  if (!provider(credential.provider))
    return recordSecretVersion(
      JSON.parse(decrypt(store, credential.encryptedSecret)),
      credential,
    );
  const key = `${store.dataDir}:${credential.id}`;
  const current = refreshes.get(key);
  if (current) return current;
  const promise = resolveExecutionSecret(store, credential, fetcher);
  refreshes.set(key, promise);
  try {
    return await promise;
  } finally {
    if (refreshes.get(key) === promise) refreshes.delete(key);
  }
}
async function resolveExecutionSecret(
  store: Store,
  initial: Credential,
  fetcher: Fetcher,
): Promise<Record<string, unknown>> {
  const credential = store.db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.id, initial.id),
        eq(credentials.workspaceId, initial.workspaceId),
      ),
    )
    .get();
  if (!credential || !provider(credential.provider))
    throw new HttpError(400, "Reconnect this credential.");
  const payload = JSON.parse(decrypt(store, credential.encryptedSecret));
  let revision = credential;
  if (
    payload.source !== "byo" ||
    typeof payload.secret_clientId !== "string" ||
    typeof payload.secret_clientSecret !== "string" ||
    typeof payload.expires_at !== "number" ||
    !Number.isFinite(payload.expires_at)
  )
    throw new HttpError(400, "Reconnect using your own OAuth application.");
  if (payload.expires_at <= Date.now() / 1000 + 60) {
    if (
      typeof payload.secret_refreshToken !== "string" ||
      !payload.secret_refreshToken
    )
      throw new HttpError(
        400,
        "Reconnect this credential: its access token has expired.",
      );
    const tokens = await tokenExchange(
      credential.provider,
      payload.secret_clientId,
      payload.secret_clientSecret,
      {
        grant_type: "refresh_token",
        refresh_token: payload.secret_refreshToken,
      },
      fetcher,
    );
    const updated = encrypt(
      store,
      JSON.stringify(applyTokens(payload, tokens)),
    );
    const result = store.db
      .update(credentials)
      .set({ encryptedSecret: updated, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(credentials.id, credential.id),
          eq(credentials.encryptedSecret, credential.encryptedSecret),
        ),
      )
      .returning()
      .get();
    if (!result)
      throw new HttpError(
        409,
        "The credential changed during refresh. Retry the run.",
      );
    revision = result;
  }
  if (
    typeof payload.secret_accessToken !== "string" ||
    !payload.secret_accessToken
  )
    throw new HttpError(400, "Reconnect this credential.");
  return recordSecretVersion(
    { secret_accessToken: payload.secret_accessToken, source: "byo" },
    revision,
  );
}
