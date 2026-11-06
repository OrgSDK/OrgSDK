import { expect, test } from "bun:test";
import { Client } from "./client";

test("executor operations use fixed routes, methods and credentials", async () => {
  const requests: Array<{
    path: string;
    method: string;
    authorization: string | null;
    body: unknown;
  }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({
        path: new URL(request.url).pathname,
        method: request.method,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      });
      if (request.url.includes("/credentials/")) {
        return Response.json({ secret: { token: "fixture" } });
      }
      return new Response(null, { status: 204 });
    },
  });
  const client = new Client(server.url.toString(), "fixture-token");
  try {
    await client.register({ protocol_version: 3, capabilities: ["code"] });
    await client.configuration();
    expect(await client.claim()).toBeUndefined();
    await client.bootstrap();
    await client.heartbeat("run-1");
    await client.publishEvent("run-1", { sequence: 1, kind: "log", data: {} });
    await client.complete("run-1", {
      status: "succeeded",
      output: { result: 42 },
    });
    await client.createApproval({ run: "run-1", prompt: "Continue?" });
    await client.approval("approval-1");
    await client.saveArtifact({ run: "run-1", name: "Result", content: "42" });
    await client.projectData("list_tables", { offset: 0 });
    expect(await client.secret("credential-1")).toEqual({ token: "fixture" });
    expect(
      requests.map(({ path, method }) => [
        method,
        path.replace("/internal/execution/v1/", ""),
      ]),
    ).toEqual([
      ["POST", "register/"],
      ["GET", "configuration/"],
      ["POST", "claim/"],
      ["POST", "bootstrap/"],
      ["POST", "runs/run-1/heartbeat/"],
      ["POST", "runs/run-1/events/"],
      ["POST", "runs/run-1/complete/"],
      ["POST", "product/approvals/"],
      ["GET", "product/approvals/approval-1/"],
      ["POST", "product/artifacts/"],
      ["POST", "product/project-data/"],
      ["GET", "credentials/credential-1/"],
    ]);
    expect(
      requests.every(
        ({ authorization }) => authorization === "Bearer fixture-token",
      ),
    ).toBe(true);
    expect(requests[10]?.body).toBe(
      JSON.stringify({ offset: 0, operation: "list_tables" }),
    );
    for (const id of [
      "..",
      "../claim",
      "%2e%2e",
      "a/b",
      "a?b",
      "https://other.test",
      "",
    ]) {
      expect(() => client.heartbeat(id)).toThrow();
      expect(() => client.approval(id)).toThrow();
      await expect(client.secret(id)).rejects.toThrow();
    }
    expect(requests).toHaveLength(12);
    expect("request" in client).toBe(false);
    expect("product" in client).toBe(false);
  } finally {
    await server.stop(true);
  }
});

test("executor refuses redirects without forwarding credentials", async () => {
  let leaked = false;
  const destination = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      leaked = true;
      return Response.json({});
    },
  });
  const redirect = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return Response.redirect(destination.url, 307);
    },
  });
  try {
    await expect(
      new Client(redirect.url.toString(), "private").claim(),
    ).rejects.toThrow();
    expect(leaked).toBe(false);
  } finally {
    await redirect.stop(true);
    await destination.stop(true);
  }
});
