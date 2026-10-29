import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { approvals, artifacts, projects } from "../db/schema";
import { appRouter } from "../router";
import { base } from "../shared/records";
import { rpcFixture } from "./rpc-fixture";

test("native document and table deletion remove project grants in the same mutation", async () => {
  const f = rpcFixture();
  try {
    const caller = f.caller();
    const document = await caller.documents.create({
      kind: "memory",
      title: "Notes",
      content: "Retained content",
    });
    const table = await caller.tables.create({
      name: "Records",
      columns: [{ key: "n", type: "number", required: true }],
    });
    const row = await caller.tables.createRow({
      id: table.id,
      table_revision: 1,
      values: { n: 1 },
    });
    f.store.db
      .update(projects)
      .set({
        readableDocuments: [document.id],
        writableDocuments: [document.id],
        readableTables: [table.id],
        writableTables: [table.id],
      })
      .where(eq(projects.id, f.project.id))
      .run();
    expect(
      (await caller.documents.update({ id: document.id, title: "Updated" }))
        .content,
    ).toBe("Retained content");
    await caller.documents.delete({ id: document.id });
    await caller.tables.delete({ id: table.id, revision: 1 });
    const project = f.store.db
      .select()
      .from(projects)
      .where(eq(projects.id, f.project.id))
      .get()!;
    expect(project.readableDocuments).toEqual([]);
    expect(project.writableDocuments).toEqual([]);
    expect(project.readableTables).toEqual([]);
    expect(project.writableTables).toEqual([]);
    await Promise.resolve(
      expect(
        caller.tables.getRow({ id: table.id, rowId: row.id }),
      ).rejects.toThrow("Not found"),
    );
  } finally {
    f.close();
  }
});

test("native cancellation interrupts pending approvals and prevents later decisions", async () => {
  const f = rpcFixture();
  try {
    const caller = f.caller();
    const run = await caller.runs.create({
      project: f.project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "approval",
    });
    const promoted = await caller.runs.promote({ id: run.id, name: "Saved" });
    expect(promoted.version.promoted_from).toBe(run.id);
    const approval = f.store.db
      .insert(approvals)
      .values({ ...base(f.workspace.id), runId: run.id, prompt: "Proceed?" })
      .returning()
      .get();
    const artifact = f.store.db
      .insert(artifacts)
      .values({
        ...base(f.workspace.id),
        runId: run.id,
        name: "Result",
        content: "value",
        mediaType: "text/plain",
      })
      .returning()
      .get();
    expect((await caller.artifacts.get({ id: artifact.id })).content).toBe(
      "value",
    );
    const member = appRouter.createCaller({ ...f.context(), role: "member" });
    await Promise.resolve(
      expect(
        member.approvals.decide({ id: approval.id, decision: "approved" }),
      ).rejects.toThrow("owners and admins"),
    );
    expect((await caller.runs.cancel({ id: run.id })).cancel_requested).toBe(
      true,
    );
    expect((await caller.approvals.get({ id: approval.id })).status).toBe(
      "interrupted",
    );
    await Promise.resolve(
      expect(
        caller.approvals.decide({ id: approval.id, decision: "approved" }),
      ).rejects.toThrow("no longer actionable"),
    );
  } finally {
    f.close();
  }
});
