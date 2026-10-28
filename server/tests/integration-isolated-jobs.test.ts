import { expect, test } from "bun:test";
import { jobSchema } from "../../runtime/src/contract";
import { fixture } from "./integration-fixture";
test("isolated protocol-three jobs cannot access project data and executor replacement revokes leases", async () => {
  const f = await fixture();
  try {
    const worker = await f.register();
    const validation = await f.json("/api/v1/actions/validate-code/", "POST", {
      project: f.project.id,
      source: "return 1;",
      idempotency_key: "isolated",
    });
    const claim = jobSchema.parse(
      await f.json("/internal/execution/v1/claim/", "POST", undefined, worker),
    );
    expect(claim.protocol_version).toBe(3);
    expect(claim.snapshot.agents[0]!.plugins).toEqual([]);
    expect(
      (
        await f.request(
          "/internal/execution/v1/product/project-data/",
          "POST",
          { operation: "list_documents" },
          claim.capability,
        )
      ).status,
    ).toBe(403);
    await f.json(`/api/v1/projects/${f.project.id}/executor/`, "DELETE");
    expect(
      (
        await f.request(
          `/internal/execution/v1/runs/${validation.id}/heartbeat/`,
          "POST",
          {},
          claim.capability,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await f.request(
          "/internal/execution/v1/claim/",
          "POST",
          undefined,
          worker,
        )
      ).status,
    ).toBe(401);
    expect((await f.json(`/api/v1/projects/${f.project.id}/`)).id).toBe(
      f.project.id,
    );
  } finally {
    await f.close();
  }
}, 15000);
