import { serve } from "bun";
import { createHash } from "node:crypto";

export function mcpOAuthFixture() {
  const exchanges: URLSearchParams[] = [];
  let challenges = "";
  let origin = "";
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        return Response.json({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ["tools"],
        });
      }
      if (url.pathname.startsWith("/.well-known/")) {
        return Response.json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (url.pathname === "/register") {
        return Response.json(
          {
            client_id: "registered-client",
            redirect_uris: ["http://localhost/oauth/mcp/callback"],
            token_endpoint_auth_method: "none",
          },
          { status: 201 },
        );
      }
      if (url.pathname === "/authorize") {
        challenges = url.searchParams.get("code_challenge") ?? "";
        return new Response("Synthetic consent");
      }
      if (url.pathname === "/token") {
        const body = new URLSearchParams(await request.text());
        exchanges.push(body);
        if (
          body.get("grant_type") === "authorization_code" &&
          createHash("sha256")
            .update(body.get("code_verifier") ?? "")
            .digest("base64url") !== challenges
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        return Response.json({
          access_token: `access-${exchanges.length}-synthetic`,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-synthetic-secret",
        });
      }
      return new Response(null, {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        },
      });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
  return {
    origin,
    endpoint: `${origin}/mcp`,
    exchanges,
    close() {
      return server.stop(true);
    },
  };
}
