import { z } from "zod";
import { pageSchema, projectSchema } from "./wire-schemas";
import { expect, test } from "bun:test";
import { fixture } from "./integration-fixture";
const toolResponseSchema = z.object({
  result: z.object({
    isError: z.boolean(),
    content: z.array(z.object({ text: z.string() })),
  }),
});
test("MCP and tRPC share persistence, reject unauthorized scopes and record client activity", async () => {
  const f = await fixture();
  try {
    const issued = z.object({ token: z.string(), id: z.string() }).parse(
      await f.data(
        "tokens.create",
        {
          name: "Scoped client",
          scopes: ["catalog:read", "code:execute", "runs:read"],
          projects: [f.project.id],
          action_versions: [],
        },
        "mutation",
      ),
    );
    const call = (method: string, params: unknown = {}) =>
      f.json(
        "/mcp/",
        "POST",
        { jsonrpc: "2.0", id: 1, method, params },
        issued.token,
      );
    const list = z
      .object({
        result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
      })
      .parse(await call("tools/list"));
    expect(list.result.tools.some((tool) => tool.name === "execute_code")).toBe(
      true,
    );
    expect(list.result.tools.some((tool) => tool.name === "save_action")).toBe(
      false,
    );
    const execute = toolResponseSchema.parse(
      await call("tools/call", {
        name: "execute_code",
        arguments: {
          project: f.project.id,
          source: "return 1;",
          idempotency_key: "mcp-code",
        },
      }),
    );
    expect(execute.result.isError).toBe(false);
    const runId = z
      .object({ id: z.string() })
      .parse(JSON.parse(execute.result.content[0]!.text)).id;
    const result = toolResponseSchema.parse(
      await call("tools/call", {
        name: "get_run",
        arguments: { id: runId },
      }),
    );
    expect(
      z
        .object({ id: z.string() })
        .parse(JSON.parse(result.result.content[0]!.text)).id,
    ).toBe(runId);
    expect(
      (
        await f.request(
          "/mcp/",
          "POST",
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "save_action",
              arguments: {
                project: f.project.id,
                name: "Denied",
                source: "return 1;",
              },
            },
          },
          issued.token,
        )
      ).status,
    ).toBe(403);
    const activity = pageSchema(
      z.object({
        id: z.string(),
        request_count: z.number(),
        error_count: z.number(),
        mcp_request_count: z.number(),
      }),
    )
      .parse(await f.data("tokens.list"))
      .results.find((token) => token.id === issued.id)!;
    expect(activity.request_count).toBe(4);
    expect(activity.error_count).toBe(1);
    expect(activity.mcp_request_count).toBe(4);
    expect(
      (await f.rpc("auth.session", undefined, "query", issued.token)).status,
    ).toBe(403);
    expect(
      (await f.rpc("auth.session", undefined, "query", issued.token)).status,
    ).toBe(403);
    const trpc = z
      .object({ result: z.object({ data: pageSchema(projectSchema) }) })
      .parse(await f.json("/trpc/projects.list"));
    expect(trpc.result.data.results[0]!.id).toBe(f.project.id);
    const denied = await fetch(`${f.origin}/trpc/projects.list`);
    expect(denied.status).toBe(401);
  } finally {
    await f.close();
  }
}, 15000);

test("tRPC batch activity records partial failure through the native transport", async () => {
  const f = await fixture();
  try {
    const issued = z.object({ id: z.string(), token: z.string() }).parse(
      await f.data(
        "tokens.create",
        {
          name: "Batched client",
          scopes: ["catalog:read"],
          projects: [f.project.id],
        },
        "mutation",
      ),
    );
    const response = await f.request(
      "/trpc/projects.list,credentials.list?batch=1&input=%7B%7D",
      "GET",
      undefined,
      issued.token,
    );
    expect(response.status).toBe(207);
    const entries = z
      .array(
        z.object({
          result: z.unknown().optional(),
          error: z.unknown().optional(),
        }),
      )
      .parse(await response.json());
    expect(entries[0]!.result).toBeDefined();
    expect(entries[1]!.error).toBeDefined();
    const activity = z
      .object({
        request_count: z.number(),
        error_count: z.number(),
        trpc_request_count: z.number(),
        last_transport: z.string(),
      })
      .parse(await f.data("tokens.get", { id: issued.id }));
    expect(activity).toMatchObject({
      request_count: 1,
      error_count: 1,
      trpc_request_count: 1,
      last_transport: "trpc",
    });
  } finally {
    await f.close();
  }
});
