import { z } from "zod";
import { runSchema } from "./wire-schemas";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import * as tables from "../db/schema";
import { maintenance } from "../execution/maintenance";
import { fixture } from "./integration-fixture";
test("run capabilities enforce serial claims, resource grants, redaction and expiry", async () => {
  const f = await fixture();
  try {
    const worker = await f.register();
    const document = z.object({ id: z.string() }).parse(
      await f.data(
        "documents.create",
        {
          title: "Allowed",
          kind: "document",
          content: "initial",
        },
        "mutation",
      ),
    );
    await f.data(
      "projects.update",
      { id: f.project.id, writable_documents: [document.id] },
      "mutation",
    );
    const credential = z.object({ id: z.string() }).parse(
      await f.data(
        "credentials.create",
        {
          name: "Test credential",
          provider: "test",
          secret: { api_key: "synthetic-private-test-value" },
        },
        "mutation",
      ),
    );
    const run = runSchema.parse(
      await f.data(
        "runs.create",
        {
          project: f.project.id,
          operation: "code",
          source: "return 1;",
          idempotency_key: "capability",
        },
        "mutation",
      ),
    );
    const claim = z
      .object({ capability: z.string() })
      .parse(
        await f.json(
          "/internal/execution/v1/claim/",
          "POST",
          undefined,
          worker,
        ),
      );
    expect(
      (
        await f.request(
          "/internal/execution/v1/claim/",
          "POST",
          undefined,
          worker,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await f.request(
          `/internal/execution/v1/credentials/${credential.id}/`,
          "GET",
          undefined,
          claim.capability,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "/internal/execution/v1/product/project-data/",
          "POST",
          {
            operation: "write_document",
            document_id: document.id,
            content: "changed",
          },
          claim.capability,
        )
      ).status,
    ).toBe(200);
    await f.data(
      "projects.update",
      { id: f.project.id, writable_documents: [] },
      "mutation",
    );
    expect(
      (
        await f.request(
          "/internal/execution/v1/product/project-data/",
          "POST",
          { operation: "get_document", document_id: document.id },
          claim.capability,
        )
      ).status,
    ).toBe(403);
    const second = z.object({ id: z.string() }).parse(
      await f.data(
        "documents.create",
        {
          title: "Added later",
          kind: "document",
          content: "secret",
        },
        "mutation",
      ),
    );
    await f.data(
      "projects.update",
      { id: f.project.id, readable_documents: [second.id] },
      "mutation",
    );
    expect(
      (
        await f.request(
          "/internal/execution/v1/product/project-data/",
          "POST",
          { operation: "get_document", document_id: second.id },
          claim.capability,
        )
      ).status,
    ).toBe(403);
    await f.json(
      `/internal/execution/v1/runs/${run.id}/events/`,
      "POST",
      {
        sequence: 1,
        kind: "log",
        data: { text: "synthetic-private-test-value" },
      },
      claim.capability,
    );
    expect(
      JSON.stringify(await f.data("runs.events", { id: run.id })),
    ).not.toContain("synthetic-private-test-value");
    expect(
      (
        await f.request(
          `/internal/execution/v1/runs/${run.id}/events/`,
          "POST",
          { sequence: 1, kind: "log", data: { text: "different" } },
          claim.capability,
        )
      ).status,
    ).toBe(409);
    f.store.db
      .update(tables.runs)
      .set({ leaseExpiresAt: "2000-01-01T00:00:00.000Z" })
      .where(eq(tables.runs.id, run.id))
      .run();
    maintenance(f.store);
    expect(
      runSchema.parse(await f.data("runs.get", { id: run.id })).status,
    ).toBe("interrupted");
    expect(
      (
        await f.request(
          `/internal/execution/v1/runs/${run.id}/heartbeat/`,
          "POST",
          {},
          claim.capability,
        )
      ).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
}, 15000);
