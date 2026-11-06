import { z } from "zod";
import { runSchema } from "./wire-schemas";
import { expect, test } from "bun:test";
import { jobSchema } from "../../runtime/src/contract";
import { fixture } from "./integration-fixture";
test("isolated protocol-three jobs cannot access project data and executor replacement revokes leases", async () => {
  const f = await fixture();
  try {
    const worker = await f.register();
    const validation = runSchema.parse(
      await f.data(
        "actions.validateCode",
        {
          project: f.project.id,
          source: "return 1;",
          idempotency_key: "isolated",
        },
        "mutation",
      ),
    );
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
    await f.data(
      "projects.disconnectExecutor",
      { id: f.project.id },
      "mutation",
    );
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
    expect(
      z
        .object({ id: z.string() })
        .parse(await f.data("projects.get", { id: f.project.id })).id,
    ).toBe(f.project.id);
  } finally {
    await f.close();
  }
}, 15000);
