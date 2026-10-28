import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createApp } from "../app";
import { openStore } from "../db";
import { sessions } from "../db/schema/core";
import { createContext } from "../http/context";
import { appRouter } from "../router";
import { digest } from "../shared/security";
import { seedWorkspace } from "./database-fixture";

export function rpcFixture() {
  const directory = mkdtempSync(join(tmpdir(), "orgsdk-rpc-"));
  const store = openStore(directory);
  const seeded = seedWorkspace(store);
  const sessionSecret = "rpc-test-session";
  store.db
    .insert(sessions)
    .values({
      id: digest(sessionSecret),
      userId: seeded.user.id,
      workspaceId: seeded.workspace.id,
      expiresAt: Date.now() + 300_000,
    })
    .run();
  const app = createApp(store);
  function request(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    headers?: Record<string, string>,
  ) {
    return new Request(`http://localhost${path}`, {
      method,
      headers: {
        cookie: `sessionid=${sessionSecret}; csrftoken=test`,
        "x-csrftoken": "test",
        origin: "http://localhost",
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  function context(token?: string) {
    return createContext(request("/trpc", "POST", undefined, token), store);
  }
  function rpc(
    path: string,
    input?: unknown,
    type: "query" | "mutation" = "query",
    token?: string,
  ) {
    const endpoint = `/trpc/${path}`;
    const url =
      type === "query" && input !== undefined
        ? `${endpoint}?input=${encodeURIComponent(JSON.stringify(input))}`
        : endpoint;
    return app(
      request(
        url,
        type === "query" ? "GET" : "POST",
        type === "mutation" ? input : undefined,
        token,
      ),
    );
  }
  async function data(
    path: string,
    input?: unknown,
    type: "query" | "mutation" = "query",
    token?: string,
  ) {
    const response = await rpc(path, input, type, token);
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`RPC ${path} failed: ${JSON.stringify(body)}`);
    }
    return z
      .object({ result: z.object({ data: z.unknown().optional() }) })
      .parse(body).result.data;
  }
  return {
    store,
    directory,
    ...seeded,
    context,
    rpc,
    data,
    caller: (token?: string) => appRouter.createCaller(context(token)),
    request: (
      path: string,
      method?: string,
      body?: unknown,
      token?: string,
      headers?: Record<string, string>,
    ) => app(request(path, method, body, token, headers)),
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
