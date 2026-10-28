import { dispatchTool } from "./mcp-dispatch";
import { object } from "../shared/contracts";
import { mcpArgumentsSchema } from "./mcp-schemas";
import Ajv from "ajv";
import { TRPCError } from "@trpc/server";
import type { AppContext } from "../http/context";
import { requireWorkspace } from "../shared/authorization";
import { HttpError, input, json } from "../http/responses";
import definitions from "./mcp-tools.json";

const scopes: Record<string, string> = {
  list_projects: "catalog:read",
  get_project_sdk: "catalog:read",
  execute_code: "code:execute",
  get_run_events: "runs:read",
  cancel_run: "runs:cancel",
  list_actions: "catalog:read",
  get_action: "catalog:read",
  validate_code: "actions:write",
  promote_run: "actions:write",
  save_tests: "actions:write",
  get_tests: "catalog:read",
  run_tests: "actions:test",
  save_action: "actions:write",
  run_action: "actions:run",
  get_run: "runs:read",
};
const validator = new Ajv({ strict: false });
validator.addFormat(
  "uuid",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);
const tools = definitions.map((definition) => ({
  ...definition,
  validate: validator.compile(definition.inputSchema),
}));
function permitted(ctx: AppContext, name: string) {
  return (
    !ctx.token || (!!scopes[name] && ctx.token.scopes.includes(scopes[name]!))
  );
}

export async function handleMcp(ctx: AppContext): Promise<Response | null> {
  if (new URL(ctx.request.url).pathname !== "/mcp/") {
    return null;
  }
  requireWorkspace(ctx);
  const origin = ctx.request.headers.get("origin");
  if (origin && origin !== new URL(ctx.request.url).origin) {
    throw new HttpError(403, "Origin is not allowed.");
  }
  if (ctx.request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  const version = ctx.request.headers.get("mcp-protocol-version");
  if (version && version !== "2025-03-26") {
    throw new HttpError(400, "Unsupported MCP protocol version.");
  }
  if (
    ctx.request.headers.get("content-type")?.split(";")[0] !==
    "application/json"
  ) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
  const accept = ctx.request.headers.get("accept") ?? "*/*";
  if (!accept.includes("application/json") && !accept.includes("*/*")) {
    throw new HttpError(406, "Accept must include application/json.");
  }
  const body = await input(ctx.request);
  const error = (
    code: number,
    message: string,
    id: unknown = body.id ?? null,
    status = 200,
  ) => json({ jsonrpc: "2.0", id, error: { code, message } }, status);
  if (
    body.jsonrpc !== "2.0" ||
    typeof body.method !== "string" ||
    (Object.hasOwn(body, "id") &&
      !["string", "number"].includes(typeof body.id))
  ) {
    return error(-32600, "Invalid request", null, 400);
  }
  const params = body.params ?? {};
  if (!object(params)) {
    return error(-32602, "Parameters must be an object");
  }
  if (
    !Object.hasOwn(body, "id") ||
    body.method === "notifications/initialized"
  ) {
    return new Response(null, { status: 202 });
  }
  let result: unknown;
  if (body.method === "initialize") {
    result = {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "OrgSDK", version: "1.0.0" },
    };
  } else if (body.method === "ping") {
    result = {};
  } else if (body.method === "tools/list") {
    result = {
      tools: tools
        .filter((tool) => permitted(ctx, tool.name))
        .map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
    };
  } else if (body.method === "tools/call") {
    const tool = tools.find((tool) => tool.name === params.name);
    if (!tool) {
      return error(-32602, "Unknown tool");
    }
    const args = params.arguments ?? {};
    if (!tool.validate(args)) {
      return error(
        -32602,
        "Invalid tool arguments. Check fields, types and limits.",
      );
    }
    if (!permitted(ctx, tool.name)) {
      throw new HttpError(403, "Client scope does not permit this tool.");
    }
    try {
      const output = await dispatchTool(
        ctx,
        tool.name,
        mcpArgumentsSchema.parse(args),
      );
      result = {
        content: [{ type: "text", text: JSON.stringify(output) }],
        isError: false,
      };
    } catch (cause) {
      if (!(cause instanceof HttpError) && !(cause instanceof TRPCError)) {
        throw cause;
      }
      result = {
        content: [
          {
            type: "text",
            text: (
              cause instanceof HttpError
                ? cause.status === 403
                : cause.code === "FORBIDDEN"
            )
              ? "Permission denied. Check client scopes and project grants."
              : "Request rejected. Check resource IDs, input fields and execution limits.",
          },
        ],
        isError: true,
      };
    }
  } else {
    return error(-32601, "Method not found");
  }
  return json({ jsonrpc: "2.0", id: body.id, result });
}
