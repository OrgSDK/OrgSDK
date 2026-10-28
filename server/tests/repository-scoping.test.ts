import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auditRecords, projects } from "../db/schema";
import { users, workspaces } from "../db/schema/core";
import { createContext } from "../http/context";
import { projectsRepository } from "../repositories/projects";
import { fixture } from "./integration-fixture";

test("repositories scope reads and writes and roll back audit records with mutations", async () => {
  const f = await fixture();
  try {
    const own = f.store.db.select().from(projects).get()!;
    const foreign = f.store.db
      .insert(workspaces)
      .values({
        name: "Other",
        host: "other.local",
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const foreignProject = f.store.db
      .insert(projects)
      .values({ ...own, id: randomUUID(), workspaceId: foreign.id })
      .returning()
      .get();
    const ctx = createContext(new Request(f.origin), f.store);
    ctx.user = f.store.db.select().from(users).get()!;
    ctx.role = "owner";
    const repository = projectsRepository(ctx);
    expect(repository.list(eq(projects.workspaceId, foreign.id))).toEqual([]);
    expect(() => repository.find(foreignProject.id)).toThrow("Not found");
    expect(() =>
      repository.update(foreignProject.id, { name: "Changed" }),
    ).toThrow("Not found");
    repository.remove(foreignProject.id);
    expect(
      f.store.db
        .select()
        .from(projects)
        .where(eq(projects.id, foreignProject.id))
        .get(),
    ).toEqual(foreignProject);
    const auditCount = f.store.db.select().from(auditRecords).all().length;
    expect(() =>
      f.store.sqlite
        .transaction(() => {
          repository.create({
            name: "Rolled back",
            enabled: true,
            readableTables: [],
            writableTables: [],
            readableDocuments: [],
            writableDocuments: [],
          });
          throw new Error("abort");
        })
        .immediate(),
    ).toThrow("abort");
    expect(repository.list()).toEqual([own]);
    expect(f.store.db.select().from(auditRecords).all()).toHaveLength(
      auditCount,
    );
  } finally {
    await f.close();
  }
});
