# Remote MCP project plugins

Project administrators can add HTTP(S) MCP servers under **Plugins → Connect MCP server**. Tools run directly from that project's executor. The OrgSDK server performs OAuth authorization and token refresh, and supplies only the connection's access headers to an authenticated run.

## Connect and use

1. Connect an updated project runner (executor protocol 4).
2. Enter a connection name such as `customer-tools`, the server URL and its authentication mode: anonymous, bearer/custom headers, or OAuth. Keep secrets in the credential fields, never in the URL.
3. For OAuth, set `ORGSDK_PUBLIC_ORIGIN` to the registered workspace origin, then use **Sign in** and open the authorization link. A pre-registered client can use `/oauth/mcp/callback` at that origin. Client ID, client secret and client metadata URL are optional; the SDK can use the server's advertised registration mechanisms.
4. **Check connection / refresh tools** queues a discovery job on the project runner. It lists tools without calling them. Review each input/output schema, select tools and accept the catalogue.
5. Discover the project SDK through the existing inbound MCP endpoint or the code editor, then call the namespace from code or a saved action:

```ts
const result = await customerTools.searchRecords({ query: "example" });
return result; // MCP result envelope: content blocks and structuredContent
```

The connection name becomes the ordinary camelCase plugin namespace. Tool names receive stable camelCase aliases. Collisions and unsafe JavaScript property names get deterministic suffixes; the original name stays in SDK metadata as `remote_name`. Input and output JSON Schemas are preserved. Editor and semantic-validation types come from those schemas; unsupported constructs produce `unknown` rather than executable remote declarations.

## Review, recovery and access

A check does not enable new tools. A refresh produces a candidate catalogue; previously enabled, unchanged tools are preselected in the review. New or changed tools need explicit acceptance. Removed tools disappear on acceptance. Existing run snapshots retain their original endpoint, transport, schemas, approved names and aliases. This pins the OrgSDK contract, not the remote implementation.

Disable/remove, endpoint/authentication replacement and removal of an enabled tool cancel affected queued/running jobs. Workers observe cancellation through the existing heartbeat. Remote effects dispatched before cancellation cannot be undone. Adding tools or accepting schema changes does not widen existing snapshots. Actions use the project contract captured for each run.

Use **Update connection** to replace credentials, choose authentication or explicitly select Streamable HTTP or legacy HTTP/SSE. Saving disables the connection until discovery and review are completed again. Offline runners need to be connected; older runners need an upgrade. Authentication failures need sign-in or replacement credentials. Failed discovery reports a bounded diagnostic and can be checked again.

OAuth authorization endpoints must be reachable from OrgSDK. OAuth discovery checks destinations and rejects redirects. HTTPS is required except loopback servers; private destinations are allowed only at the explicitly configured MCP origin. Runner discovery can supply protected-resource metadata when the MCP resource itself is not reachable from OrgSDK. Cross-origin authentication forwarding is prohibited. Refresh tokens and client secrets stay encrypted on OrgSDK and are never sent to runners. Generic credential editing cannot repurpose an MCP credential.

## Runtime boundaries

- Official `@modelcontextprotocol/client` is pinned to **2.4.0**. Protocol negotiation is automatic. Transport `auto` attempts legacy SSE only on a definite 404/405 from the HTTP connection attempt; 401/403 and outages do not trigger fallback.
- A transport factory is separate from the reusable client's connect/discover/call/close operations. Connections open lazily and are reused only within one run; completion, failure and cancellation close them.
- Tool calls use the reviewed definition, including output validation, and are never automatically replayed after ambiguous failure. Tool-level `isError` results fail the call with bounded, redacted diagnostics.
- Limits: 60 seconds total discovery; 15 seconds per connection/discovery request; 100 pages, 1,000 tools and 500 KB catalogue JSON; 60 seconds per dispatched tool call; 1 MB received response stream/result; 200 KB OAuth responses and 15 seconds per OAuth HTTP request. The normal run/source/trace limits also apply.
- Discovery capabilities cannot execute user code, call product operations, create approvals/artifacts or retrieve unrelated credentials. They contain one configured connection and no enabled tools.
- Semantic validation and action tests use metadata and existing mocks only. They have no MCP connection or credential authority.
- Protocol 4 is required for MCP execution/discovery and isolated validation/testing of MCP metadata. Older executors continue to claim compatible jobs.
- Schema migration `0003_remote-mcp` adds the connection table without changing existing plugin, credential, action-version or run records. Runtime code uses HTTP APIs and never opens the product database.

Resources, prompts, sampling, elicitation, asynchronous task extensions and stdio execution are outside this implementation. HTTP servers must support ordinary MCP tool calls and one of the authentication modes above. No arbitrary external server compatibility claim is implied.

## Verification

Protocol fixtures cover current and older Streamable HTTP, JSON/SSE bodies, legacy SSE, pagination, transport fallback, auth failures, cross-origin redirects, cancellation and redaction. Server integration tests exercise catalogue review, SDK discovery, separate-process code/action execution, traces, access removal, immutable snapshots, older-worker rejection and discovery authority. OAuth fixtures cover dynamic/pre-registered clients, PKCE, browser-session state, issuer checks, endpoint replacement and concurrent refresh. Isolated tests exercise existing tool mocks without network access.

Run `npm run check`, `npm run e2e`, `npm run build` and `npm run smoke:binary`. Run the built Node application through `ORGSDK_E2E_NODE_ENTRY=dist/server/index.js npm run e2e`. Build/pack locally, then `npm run test:distribution -- /absolute/path/package.tgz`; its fresh Node-only installation now includes MCP discovery and execution through the packaged runner. These checks use temporary installations and synthetic credentials. Publication, deployment and existing installation upgrades are separate operations.

Protocol references: [SDK protocol support](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html) and [OAuth client guidance](https://ts.sdk.modelcontextprotocol.io/v2/clients/oauth.html).
