import { z } from "zod";
import { ServiceError } from "../shared/errors";
import { type Fetcher, type Provider, providers } from "./providers";
export type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export async function tokenExchange(
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
  if (providerName === "twitter-oauth") {
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    );
  } else {
    fields.set("client_secret", clientSecret);
  }
  try {
    const response = await fetcher(providers[providerName].token, {
      method: "POST",
      headers,
      body: fields,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok || !response.body) {
      throw new Error();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) {
        break;
      }
      size += item.value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(item.value);
    }
    const value = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (
      typeof value.access_token !== "string" ||
      !value.access_token ||
      value.access_token.length > 32000 ||
      (value.refresh_token !== undefined &&
        (typeof value.refresh_token !== "string" ||
          value.refresh_token.length > 32000)) ||
      (value.scope !== undefined &&
        (typeof value.scope !== "string" || value.scope.length > 10000))
    ) {
      throw new Error();
    }
    const seconds = Number(value.expires_in ?? 3600);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 315360000) {
      throw new Error();
    }
    return {
      access_token: value.access_token,
      expires_in: seconds,
      ...(value.refresh_token ? { refresh_token: value.refresh_token } : {}),
      ...(value.scope ? { scope: value.scope } : {}),
    };
  } catch {
    throw new ServiceError(
      "BAD_REQUEST",
      "OAuth token exchange failed. Check the app settings and reconnect.",
    );
  }
}

export function applyTokens(payload: Record<string, unknown>, tokens: Tokens) {
  payload.secret_accessToken = tokens.access_token;
  payload.expires_at = Date.now() / 1000 + (tokens.expires_in ?? 3600);
  if (tokens.refresh_token) {
    payload.secret_refreshToken = tokens.refresh_token;
  }
  if (tokens.scope) {
    payload.scopes = tokens.scope.split(/\s+/).filter(Boolean);
  }
  return payload;
}
