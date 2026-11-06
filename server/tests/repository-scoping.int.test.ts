import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auditRecords, projects, workspaces } from "../db/schema";
import { inTransaction } from "../db/transaction";
import { projectsRepository } from "../repositories/projects";
import { rpcFixture } from "./rpc-fixture";

test("shared project reads and updates stay scoped and roll back their audit records", () => {
  const fixture = rpcFixture();
  try {
    const foreign = fixture.store.db
      .insert(workspaces)
      .values({
        name: "Other",
        host: "other.local",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const foreignProject = fixture.store.db
      .insert(projects)
      .values({ ...fixture.project, id: randomUUID(), workspaceId: foreign.id })
      .returning()
      .get();
    const context = fixture.context();
    const repository = projectsRepository(context);
    expect(repository.list(eq(projects.workspaceId, foreign.id))).toEqual([]);
    expect(() => repository.find(foreignProject.id)).toThrow("Not found");
    expect(() =>
      repository.update(foreignProject.id, { name: "Changed" }),
    ).toThrow("Not found");
    expect(
      fixture.store.db
        .select()
        .from(projects)
        .where(eq(projects.id, foreignProject.id))
        .get(),
    ).toEqual(foreignProject);
    const auditCount = fixture.store.db
      .select()
      .from(auditRecords)
      .all().length;
    expect(() =>
      inTransaction(context, (transaction) => {
        projectsRepository(transaction).update(fixture.project.id, {
          name: "Rolled back",
        });
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(repository.list()).toEqual([fixture.project]);
    expect(fixture.store.db.select().from(auditRecords).all()).toHaveLength(
      auditCount,
    );
  } finally {
    fixture.close();
  }
});

test("project procedure mutations reject foreign IDs and roll back when audit writing fails", async () => {
  const fixture = rpcFixture();
  try {
    const caller = fixture.caller();
    const foreign = fixture.store.db
      .insert(workspaces)
      .values({
        name: "Other",
        host: "other.local",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const foreignProject = fixture.store.db
      .insert(projects)
      .values({ ...fixture.project, id: randomUUID(), workspaceId: foreign.id })
      .returning()
      .get();
    await Promise.resolve(
      expect(caller.projects.delete({ id: foreignProject.id })).rejects.toThrow(
        "Not found",
      ),
    );
    expect(
      fixture.store.db
        .select()
        .from(projects)
        .where(eq(projects.id, foreignProject.id))
        .get(),
    ).toEqual(foreignProject);
    const auditCount = fixture.store.db
      .select()
      .from(auditRecords)
      .all().length;
    fixture.store.db.run(sql`CREATE TRIGGER reject_project_audit
      BEFORE INSERT ON audit_records
      WHEN NEW.action = 'project.created'
      BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
    await Promise.resolve(
      expect(caller.projects.create({ name: "Rolled back" })).rejects.toThrow(
        "audit unavailable",
      ),
    );
    expect(await caller.projects.list()).toMatchObject({
      results: [{ id: fixture.project.id, name: fixture.project.name }],
    });
    expect(fixture.store.db.select().from(auditRecords).all()).toHaveLength(
      auditCount,
    );
  } finally {
    fixture.close();
  }
});
