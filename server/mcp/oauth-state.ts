import { z } from "zod";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import { ServiceError } from "../shared/errors";

const metadata = z
  .object({
    issuer: z.string(),
    authorization_endpoint: z.string(),
    token_endpoint: z.string(),
    response_types_supported: z.array(z.string()),
    registration_endpoint: z.string().optional(),
    code_challenge_methods_supported: z.array(z.string()).optional(),
    token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
    client_id_metadata_document_supported: z.boolean().optional(),
    authorization_response_iss_parameter_supported: z.boolean().optional(),
  })
  .passthrough();
const resource = z
  .object({
    resource: z.string(),
    authorization_servers: z.array(z.string()).optional(),
    scopes_supported: z.array(z.string()).optional(),
  })
  .passthrough();
const client = z
  .object({
    client_id: z.string(),
    client_secret: z.string().optional(),
    issuer: z.string().optional(),
  })
  .passthrough();
const tokens = z
  .object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number().optional(),
    refresh_token: z.string().optional(),
    scope: z.string().optional(),
    issuer: z.string().optional(),
  })
  .passthrough();
export const oauthStateSchema = z.object({
  endpoint: z.string(),
  plugin: z.string(),
  revision: z.number(),
  redirectUri: z.string(),
  state: z.string(),
  verifier: z.string().optional(),
  authorizationUrl: z.string().optional(),
  client: client.optional(),
  tokens: tokens.optional(),
  expiresAt: z.number().optional(),
  clientMetadataUrl: z.string().optional(),
  discovery: z
    .object({
      authorizationServerUrl: z.string(),
      authorizationServerMetadata: metadata.optional(),
      resourceMetadata: resource.optional(),
      resourceMetadataUrl: z.string().optional(),
    })
    .optional(),
});
export type OAuthState = z.infer<typeof oauthStateSchema>;
export function oauthProvider(state: OAuthState): OAuthClientProvider {
  return {
    redirectUrl: state.redirectUri,
    ...(state.clientMetadataUrl
      ? { clientMetadataUrl: state.clientMetadataUrl }
      : {}),
    clientMetadata: {
      client_name: "OrgSDK",
      redirect_uris: [state.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: state.client?.client_secret
        ? "client_secret_post"
        : "none",
    },
    state: () => state.state,
    clientInformation: (context) =>
      state.client && (!context || state.client.issuer === context.issuer)
        ? state.client
        : undefined,
    saveClientInformation: (value) => {
      state.client = client.parse(value);
    },
    tokens: (context) =>
      state.tokens && (!context || state.tokens.issuer === context.issuer)
        ? state.tokens
        : undefined,
    saveTokens: (value) => {
      state.tokens = tokens.parse(value);
      state.expiresAt = Date.now() + (value.expires_in ?? 3600) * 1000;
    },
    redirectToAuthorization: (url) => {
      state.authorizationUrl = url.toString();
    },
    saveCodeVerifier: (verifier) => {
      state.verifier = verifier;
    },
    codeVerifier: () => {
      if (!state.verifier) {
        throw new ServiceError("BAD_REQUEST", "Restart authorization.");
      }
      return state.verifier;
    },
    discoveryState: () =>
      state.discovery
        ? {
            authorizationServerUrl: state.discovery.authorizationServerUrl,
            ...(state.discovery.authorizationServerMetadata
              ? {
                  authorizationServerMetadata:
                    state.discovery.authorizationServerMetadata,
                }
              : {}),
            ...(state.discovery.resourceMetadata
              ? { resourceMetadata: state.discovery.resourceMetadata }
              : {}),
            ...(state.discovery.resourceMetadataUrl
              ? { resourceMetadataUrl: state.discovery.resourceMetadataUrl }
              : {}),
          }
        : undefined,
    saveDiscoveryState: (value) => {
      state.discovery = oauthStateSchema.shape.discovery.parse(value);
    },
  };
}
