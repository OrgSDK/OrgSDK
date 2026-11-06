import { expect, test } from "bun:test";
import { plugins } from "../db/schema";
import { projectSnapshot } from "../projects/snapshot";
import { createRun } from "../runs/create";
import { base } from "../shared/records";
import { credentialFixture } from "./credentials-fixture";

test("typed run snapshots retain valid large plugin source without a request-body size cap", () => {
  const fixture = credentialFixture();
  try {
    const pluginSource =
      "export default () => ({ safeFunctions: [] });" + " ".repeat(199_900);
    fixture.store.db
      .insert(plugins)
      .values({
        ...base(fixture.workspace.id),
        projectId: fixture.project.id,
        slug: "large-plugin",
        version: "1",
        source: pluginSource,
        digest: "test",
      })
      .run();
    const run = createRun(fixture.context(), {
      project: fixture.project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "large-plugin",
    });
    expect(run.status).toBe("queued");
    expect(Buffer.byteLength(JSON.stringify(run.snapshot))).toBeGreaterThan(
      200_000,
    );
  } finally {
    fixture.close();
  }
});

test("invalid pinned plugin metadata is not reported as complete after narrowing JSON types", () => {
  const fixture = credentialFixture();
  try {
    fixture.store.db
      .insert(plugins)
      .values({
        ...base(fixture.workspace.id),
        projectId: fixture.project.id,
        slug: "incomplete-plugin",
        version: "1",
        digest: "test",
        distribution: "external",
        releaseMetadata: {
          tools: [{ name: "validTool", parameters: [] }, "invalid"],
        },
      })
      .run();
    const snapshot = projectSnapshot(fixture.context(), fixture.project.id);
    expect(snapshot.sdk.plugins[0]!.metadata_complete).toBe(false);
    expect(snapshot.sdk.plugins[0]!.tools).toEqual([
      { name: "validTool", parameters: [], calling: "named" },
    ]);
  } finally {
    fixture.close();
  }
});
