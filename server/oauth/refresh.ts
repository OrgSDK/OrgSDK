import { and, eq } from "drizzle-orm";
import type { Store } from "../db";
import { credentials } from "../db/schema";
import { HttpError } from "../http/responses";
import { decrypt, encrypt } from "../shared/security";
import { type Credential, type Fetcher, provider } from "./providers";
import { applyTokens, tokenExchange } from "./tokens";
export const refreshes = new Map<string, Promise<Record<string, unknown>>>();

export const secretVersions = new WeakMap<
  Record<string, unknown>,
  { id: string; workspaceId: number; provider: string; encryptedSecret: string }
>();

export function recordSecretVersion(
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

export async function resolveExecutionSecret(
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
