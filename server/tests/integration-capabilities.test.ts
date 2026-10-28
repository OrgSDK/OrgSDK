import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import * as tables from "../db/schema";
import { maintenance } from "../execution/maintenance";
import { fixture } from "./integration-fixture";
test("run capabilities enforce serial claims, resource grants, redaction and expiry", async () => {
  const f = await fixture();
  try {
    const worker = await f.register();
    const document = await f.json("/api/v1/documents/", "POST", {
      title: "Allowed",
      kind: "document",
      content: "initial",
    });
    await f.json(`/api/v1/projects/${f.project.id}/`, "PATCH", {
      writable_documents: [document.id],
    });
    const credential = await f.json("/api/v1/credentials/", "POST", {
      name: "Test credential",
      provider: "test",
      secret: { api_key: "synthetic-private-test-value" },
    });
    const run = await f.json("/api/v1/runs/", "POST", {
      project: f.project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "capability",
    });
    const claim = await f.json(
      "/internal/execution/v1/claim/",
      "POST",
      undefined,
      worker,
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
    await f.json(`/api/v1/projects/${f.project.id}/`, "PATCH", {
      writable_documents: [],
    });
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
    const second = await f.json("/api/v1/documents/", "POST", {
      title: "Added later",
      kind: "document",
      content: "secret",
    });
    await f.json(`/api/v1/projects/${f.project.id}/`, "PATCH", {
      readable_documents: [second.id],
    });
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
      JSON.stringify(await f.json(`/api/v1/runs/${run.id}/events/`)),
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
    expect((await f.json(`/api/v1/runs/${run.id}/`)).status).toBe(
      "interrupted",
    );
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
