import { and, eq } from "drizzle-orm";
import { type credentials, type plugins } from "../db/schema";
import { memberships } from "../db/schema/core";
import type { AppContext } from "../http/context";
import { requireManager } from "../http/context";
import { HttpError } from "../http/responses";
export const providers = {
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

export type Provider = keyof typeof providers;

export type Credential = typeof credentials.$inferSelect;

export type Fetcher = typeof fetch;

export type Payload = {
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

export function provider(value: unknown): value is Provider {
  return typeof value === "string" && Object.hasOwn(providers, value);
}

export function field(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, "Provide valid connection settings.");
  return value.trim();
}

export function callbackOrigin(ctx: AppContext): string {
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

export function authorize(ctx: AppContext) {
  if (ctx.token || !ctx.sessionId)
    throw new HttpError(403, "OAuth connections require a browser session.");
  return requireManager(ctx);
}

export function checkedMetadata(plugin: typeof plugins.$inferSelect) {
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

export function isCurrentManager(
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
