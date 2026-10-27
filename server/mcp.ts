import Ajv from "ajv";
import type { AppContext } from "./context";
import { requireWorkspace } from "./context";
import { handleDomain } from "./domain";
import { HttpError, input, json } from "./http";
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
const clientScopes = new Set(Object.values(scopes));
const validator = new Ajv({ strict: false });
validator.addFormat(
  "uuid",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);
const tools = definitions.map((definition) => ({
  ...definition,
  validate: validator.compile(definition.inputSchema),
}));
function permitted(ctx: AppContext, name: string, mutates: boolean) {
  if (!ctx.token) return true;
  const tokenScopes: string[] = ctx.token.scopes;
  if (tokenScopes.some((scope) => clientScopes.has(scope)))
    return !!scopes[name] && tokenScopes.includes(scopes[name]!);
  return tokenScopes.includes(mutates ? "write" : "read");
}

async function domain(
  ctx: AppContext,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  const headers = new Headers(ctx.request.headers);
  headers.set("Content-Type", "application/json");
  const request = new Request(new URL(path, ctx.request.url), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handleDomain({ ...ctx, request });
  if (!response) throw new HttpError(404, "Resource not found.");
  if (response.status === 204) return {};
  const result = await response.json();
  if (!response.ok)
    throw new HttpError(response.status, result.detail ?? "Request rejected.");
  return result;
}
async function dispatch(
  ctx: AppContext,
  name: string,
  args: Record<string, any>,
) {
  const list = async (resource: string) =>
    (await domain(ctx, `/api/v1/${resource}/`)).results;
  const actionPath = `/api/v1/actions/${args.action}/`;
  switch (name) {
    case "list_projects": {
      const all = await list("projects");
      const start = args.offset ?? 0,
        limit = args.limit ?? 100;
      const projects = all.slice(start, start + limit);
      return {
        projects,
        next_offset:
          start + projects.length < all.length ? start + projects.length : null,
      };
    }
    case "get_project_sdk":
      return domain(
        ctx,
        `/api/v1/projects/${args.project}/sdk/${args.namespace ? `?namespace=${encodeURIComponent(args.namespace)}` : ""}`,
      );
    case "execute_code":
      return domain(ctx, "/api/v1/runs/", "POST", {
        ...args,
        operation: "code",
      });
    case "get_run_events": {
      const all = await domain(ctx, `/api/v1/runs/${args.id}/events/`);
      const events = all
        .filter((event: any) => event.sequence > (args.after ?? 0))
        .slice(0, args.limit ?? 100);
      return {
        events,
        next_cursor: events.at(-1)?.sequence ?? args.after ?? 0,
      };
    }
    case "cancel_run":
      return domain(ctx, `/api/v1/runs/${args.id}/cancel/`, "POST", {});
    case "list_actions": {
      const all = await list("actions");
      const filtered = args.project
        ? all.filter(
            (action: any) => (action.project ?? action.agent) === args.project,
          )
        : all;
      return filtered.slice(
        args.offset ?? 0,
        (args.offset ?? 0) + (args.limit ?? 100),
      );
    }
    case "get_action":
      return {
        action: await domain(ctx, actionPath),
        version: await domain(
          ctx,
          `${actionPath}version/?version=${args.version}`,
        ),
      };
    case "validate_code":
      return domain(ctx, "/api/v1/actions/validate-code/", "POST", args);
    case "promote_run":
      return domain(ctx, `/api/v1/runs/${args.id}/promote/`, "POST", args);
    case "save_tests":
      return domain(ctx, `${actionPath}tests/`, "POST", args);
    case "get_tests":
      return domain(
        ctx,
        `${actionPath}tests/?version=${args.version}${args.suite_revision ? `&suite_revision=${args.suite_revision}` : ""}`,
      );
    case "run_tests":
      return domain(ctx, `${actionPath}run-tests/`, "POST", args);
    case "save_action":
      return domain(ctx, "/api/v1/actions/save-action/", "POST", args);
    case "run_action": {
      let project = args.project ?? args.agent;
      if (!project) {
        const action = await domain(ctx, actionPath);
        project = action.project ?? action.agent;
      }
      return domain(ctx, "/api/v1/runs/", "POST", {
        ...args,
        project,
        operation: "action",
      });
    }
    case "get_run":
      return domain(ctx, `/api/v1/runs/${args.id}/`);
    case "list_approvals":
      return (await list("approvals")).filter(
        (entry: any) => entry.status === "pending",
      );
    case "list_plugins":
      return (await list("plugins")).map((entry: any) => ({
        slug: entry.slug,
        version: entry.version,
        description: entry.description,
        enabled: entry.enabled,
      }));
    case "list_documents":
      return list("documents");
    default:
      throw new HttpError(400, "Unknown tool.");
  }
}

export async function handleMcp(ctx: AppContext): Promise<Response | null> {
  if (new URL(ctx.request.url).pathname !== "/mcp/") return null;
  requireWorkspace(ctx);
  const origin = ctx.request.headers.get("origin");
  if (origin && origin !== new URL(ctx.request.url).origin)
    throw new HttpError(403, "Origin is not allowed.");
  if (ctx.request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const version = ctx.request.headers.get("mcp-protocol-version");
  if (version && version !== "2025-03-26")
    throw new HttpError(400, "Unsupported MCP protocol version.");
  if (
    ctx.request.headers.get("content-type")?.split(";")[0] !==
    "application/json"
  )
    throw new HttpError(415, "Content-Type must be application/json.");
  const accept = ctx.request.headers.get("accept") ?? "*/*";
  if (!accept.includes("application/json") && !accept.includes("*/*"))
    throw new HttpError(406, "Accept must include application/json.");
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
  )
    return error(-32600, "Invalid request", null, 400);
  const params = body.params ?? {};
  if (!params || typeof params !== "object" || Array.isArray(params))
    return error(-32602, "Parameters must be an object");
  if (!Object.hasOwn(body, "id") || body.method === "notifications/initialized")
    return new Response(null, { status: 202 });
  let result: unknown;
  if (body.method === "initialize")
    result = {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "OrgSDK", version: "1.0.0" },
    };
  else if (body.method === "ping") result = {};
  else if (body.method === "tools/list")
    result = {
      tools: tools
        .filter((tool) => permitted(ctx, tool.name, tool.mutates))
        .map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
    };
  else if (body.method === "tools/call") {
    const tool = tools.find((tool) => tool.name === params.name);
    if (!tool) return error(-32602, "Unknown tool");
    const args = params.arguments ?? {};
    if (!tool.validate(args))
      return error(
        -32602,
        "Invalid tool arguments. Check fields, types and limits.",
      );
    if (!permitted(ctx, tool.name, tool.mutates))
      throw new HttpError(403, "Client scope does not permit this tool.");
    try {
      const output = await dispatch(ctx, tool.name, args);
      result = {
        content: [{ type: "text", text: JSON.stringify(output) }],
        isError: false,
      };
    } catch (cause) {
      if (!(cause instanceof HttpError)) throw cause;
      result = {
        content: [
          {
            type: "text",
            text:
              cause.status === 403
                ? "Permission denied. Check client scopes and project grants."
                : "Request rejected. Check resource IDs, input fields and execution limits.",
          },
        ],
        isError: true,
      };
    }
  } else return error(-32601, "Method not found");
  return json({ jsonrpc: "2.0", id: body.id, result });
}
