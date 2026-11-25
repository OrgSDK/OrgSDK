import { expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { z } from "zod";
import worker from "../../deploy/feedback/worker";
import { receipt } from "../feedback/contract";
import { rpcFixture } from "./rpc-fixture";

const schema = readFileSync(
  new URL("../../deploy/feedback/migrations/0001_reports.sql", import.meta.url),
  "utf8",
);

test("separate installations share one private inbox, with scoped submissions and stable receipts", async () => {
  const first = rpcFixture();
  const second = rpcFixture();
  const inbox = new Database(":memory:");
  inbox.exec(schema);
  let accepting = true;
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...values: (string | null)[]) => ({
          first: () => Promise.resolve(inbox.query(sql).get(...values)),
        }),
      }),
    },
    SUBMISSIONS: { limit: () => Promise.resolve({ success: accepting }) },
  };
  const endpoint = "https://feedback.orgsdk.ai/v1/reports";
  const deliveries: Request[] = [];
  const transport = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = new Request(url, init);
        expect(request.url).toBe(endpoint);
        expect(request.headers.has("authorization")).toBe(false);
        expect(request.headers.has("cookie")).toBe(false);
        deliveries.push(request.clone());
        return worker.fetch(request, env);
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const report = {
    category: "plugin_failure",
    summary: "Search returned no results",
    observed: "The test record was missing",
    expected: "Search should return the test record",
    plugin: "example-search",
    idempotency_key: crypto.randomUUID(),
  };
  const submit = (installation: typeof first, token: string, args = report) =>
    installation.request(
      "/mcp/",
      "POST",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "submit_feedback", arguments: args },
      },
      token,
    );
  async function result(response: Response) {
    return z
      .object({
        result: z.object({
          content: z.tuple([z.object({ text: z.string() })]),
          isError: z.boolean(),
        }),
      })
      .parse(await response.json()).result;
  }
  async function reportId(response: Response) {
    const body = await result(response);
    expect(body.isError).toBe(false);
    return receipt.parse(JSON.parse(body.content[0].text)).report_id;
  }
  try {
    const issue = (installation: typeof first) =>
      installation
        .caller()
        .tokens.create({ name: "Feedback", scopes: ["feedback:submit"] });
    const { token } = await issue(first);
    const other = await issue(second);
    const denied = await first
      .caller()
      .tokens.create({ name: "Reader", scopes: ["catalog:read"] });
    for (const [credential, visible] of [
      [token, true],
      [denied.token, false],
    ] as const) {
      const list = await first.request(
        "/mcp/",
        "POST",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        credential,
      );
      expect((await list.text()).includes("submit_feedback")).toBe(visible);
    }
    expect((await submit(first, denied.token)).status).toBe(403);
    expect(
      (await first.rpc("feedback.submit", report, "mutation", denied.token))
        .status,
    ).toBe(403);
    expect(deliveries).toHaveLength(0);
    const id = await reportId(await submit(first, token));
    expect(
      Object.keys(
        z.record(z.string(), z.unknown()).parse(await deliveries[0]?.json()),
      ).sort(),
    ).toEqual([
      "category",
      "expected",
      "observed",
      "platform_version",
      "plugin",
      "submission_key",
      "summary",
    ]);
    expect(await reportId(await submit(first, token))).toBe(id);
    expect(await reportId(await submit(second, other.token))).not.toBe(id);
    expect(
      inbox
        .query(
          "SELECT category, plugin, status FROM reports ORDER BY received_at",
        )
        .all(),
    ).toEqual(
      Array.from({ length: 2 }, () => ({
        category: "plugin_failure",
        plugin: "example-search",
        status: "open",
      })),
    );
    inbox
      .query(
        "UPDATE reports SET status = 'resolved', fix_reference = 'fix-1' WHERE report_id = ?",
      )
      .run(id);
    expect(
      (
        await result(
          await submit(first, token, { ...report, summary: "Changed" }),
        )
      ).isError,
    ).toBe(true);
    expect(await reportId(await submit(first, token))).toBe(id);
    expect(
      inbox
        .query("SELECT status, fix_reference FROM reports WHERE report_id = ?")
        .get(id),
    ).toEqual({ status: "resolved", fix_reference: "fix-1" });
    for (const method of ["GET", "PATCH", "DELETE"]) {
      expect(
        (await worker.fetch(new Request(endpoint, { method }), env)).status,
      ).toBe(405);
    }
    expect(
      (await worker.fetch(new Request(endpoint + "/" + id), env)).status,
    ).toBe(404);
    const invalid = (body: string) =>
      worker.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
        env,
      );
    expect((await invalid("{}")).status).toBe(400);
    expect((await invalid("x".repeat(32769))).status).toBe(413);
    accepting = false;
    expect(
      (await result(await submit(first, token))).content[0].text,
    ).toContain("Wait one minute");
    transport.mockRejectedValueOnce(new Error("offline"));
    expect(
      (await result(await submit(first, token))).content[0].text,
    ).toContain("Retry with the same");
  } finally {
    transport.mockRestore();
    first.close();
    second.close();
    inbox.close();
  }
});
