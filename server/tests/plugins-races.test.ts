import { expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  auditRecords,
  credentials,
  memberships,
  plugins,
  projects,
  sessions,
} from "../db/schema";
import { catalogFetch, pluginRaceFixture } from "./plugin-race-fixture";

test("plugin create rechecks project and selected credential after the catalog await", async () => {
  for (const deletedReference of ["project", "credential"]) {
    const fixture = pluginRaceFixture();
    const fetcher = spyOn(globalThis, "fetch").mockImplementation(
      catalogFetch(() => {
        if (deletedReference === "project") {
          fixture.concurrentStore.db
            .delete(projects)
            .where(eq(projects.id, fixture.project.id))
            .run();
        } else {
          fixture.concurrentStore.db
            .delete(credentials)
            .where(eq(credentials.id, fixture.credential.id))
            .run();
        }
        return Response.json([fixture.release]);
      }),
    );
    try {
      await Promise.resolve(
        expect(
          fixture.caller().plugins.create(fixture.input),
        ).rejects.toMatchObject({ code: "NOT_FOUND" }),
      );
      expect(fixture.store.db.select().from(plugins).all()).toEqual([]);
      expect(fixture.store.db.select().from(auditRecords).all()).toEqual([]);
    } finally {
      fetcher.mockRestore();
      fixture.close();
    }
  }
});

test("plugin create reports a checked duplicate when another installation wins the catalog await", async () => {
  const fixture = pluginRaceFixture();
  const fetcher = spyOn(globalThis, "fetch").mockImplementation(
    catalogFetch(() => {
      fixture.install();
      return Response.json([fixture.release]);
    }),
  );
  try {
    await Promise.resolve(
      expect(
        fixture.caller().plugins.create(fixture.input),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" }),
    );
    expect(fixture.store.db.select().from(plugins).all()).toHaveLength(1);
    expect(fixture.store.db.select().from(auditRecords).all()).toEqual([]);
  } finally {
    fetcher.mockRestore();
    fixture.close();
  }
});

test("plugin refresh rejects concurrent state changes even when timestamp, version and digest are unchanged", async () => {
  const fixture = pluginRaceFixture();
  const plugin = fixture.install();
  const fetcher = spyOn(globalThis, "fetch").mockImplementation(
    catalogFetch(() => {
      fixture.concurrentStore.db
        .update(plugins)
        .set({ enabled: false, configuration: { region: "concurrent" } })
        .where(eq(plugins.id, plugin.id))
        .run();
      return Response.json([
        { ...fixture.release, version: "2", digest: "b".repeat(64) },
      ]);
    }),
  );
  try {
    await Promise.resolve(
      expect(
        fixture.caller().plugins.update({ id: plugin.id, version: "2" }),
      ).rejects.toMatchObject({ code: "CONFLICT" }),
    );
    const current = fixture.store.db
      .select()
      .from(plugins)
      .where(eq(plugins.id, plugin.id))
      .get()!;
    expect(current.updatedAt).toBe(plugin.updatedAt);
    expect(current.version).toBe(plugin.version);
    expect(current.digest).toBe(plugin.digest);
    expect(current.enabled).toBe(false);
    expect(current.configuration).toEqual({ region: "concurrent" });
    expect(fixture.store.db.select().from(auditRecords).all()).toEqual([]);
  } finally {
    fetcher.mockRestore();
    fixture.close();
  }
});

test("plugin refresh revalidates an unchanged credential reference against its current provider", async () => {
  const fixture = pluginRaceFixture();
  const plugin = fixture.install();
  const fetcher = spyOn(globalThis, "fetch").mockImplementation(
    catalogFetch(() => {
      fixture.concurrentStore.db
        .update(credentials)
        .set({ provider: "changed-provider" })
        .where(eq(credentials.id, fixture.credential.id))
        .run();
      return Response.json([
        { ...fixture.release, version: "2", digest: "b".repeat(64) },
      ]);
    }),
  );
  try {
    await Promise.resolve(
      expect(
        fixture.caller().plugins.update({ id: plugin.id, version: "2" }),
      ).rejects.toThrow("provider"),
    );
    const current = fixture.store.db
      .select()
      .from(plugins)
      .where(eq(plugins.id, plugin.id))
      .get()!;
    expect(current).toEqual(plugin);
    expect(fixture.store.db.select().from(auditRecords).all()).toEqual([]);
  } finally {
    fetcher.mockRestore();
    fixture.close();
  }
});

test("plugin installation rejects session or manager access revoked during catalog loading", async () => {
  for (const revokedAuthority of ["membership", "session"]) {
    const fixture = pluginRaceFixture();
    const fetcher = spyOn(globalThis, "fetch").mockImplementation(
      catalogFetch(() => {
        if (revokedAuthority === "membership") {
          fixture.concurrentStore.db
            .update(memberships)
            .set({ role: "member" })
            .where(eq(memberships.userId, fixture.user.id))
            .run();
        } else {
          fixture.concurrentStore.db
            .delete(sessions)
            .where(eq(sessions.userId, fixture.user.id))
            .run();
        }
        return Response.json([fixture.release]);
      }),
    );
    try {
      await Promise.resolve(
        expect(
          fixture.caller().plugins.create(fixture.input),
        ).rejects.toMatchObject({
          code:
            revokedAuthority === "membership" ? "FORBIDDEN" : "UNAUTHORIZED",
        }),
      );
      expect(fixture.store.db.select().from(plugins).all()).toEqual([]);
      expect(fixture.store.db.select().from(auditRecords).all()).toEqual([]);
    } finally {
      fetcher.mockRestore();
      fixture.close();
    }
  }
});
