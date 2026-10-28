import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionVersions,
  auditRecords,
  schedules,
  webhooks,
} from "../db/schema";
import { digest } from "../shared/security";
import { automationFixture } from "./automation-fixture";

test("native schedules validate contracts and cron without partial mutations", async () => {
  const f = await automationFixture();
  try {
    const caller = f.caller();
    const saved = await caller.schedules.create({
      action: f.saved.action,
      cron: "*/5 * * * *",
      inputs: { value: 1 },
    });
    expect(saved.inputs).toEqual({ value: 1 });
    expect(Date.parse(saved.next_run_at)).toBeGreaterThan(Date.now());
    const auditBefore = f.store.db.select().from(auditRecords).all().length;
    await Promise.resolve(
      expect(
        caller.schedules.update({ id: saved.id, inputs: { value: "bad" } }),
      ).rejects.toThrow(),
    );
    await Promise.resolve(
      expect(
        caller.schedules.update({ id: saved.id, cron: "not a cron" }),
      ).rejects.toThrow("five-field UTC"),
    );
    await Promise.resolve(
      expect(
        caller.schedules.update({
          id: saved.id,
          action: f.foreignSaved.action,
        }),
      ).rejects.toThrow("Not found"),
    );
    expect(await caller.schedules.get({ id: saved.id })).toEqual(saved);
    expect(f.store.db.select().from(auditRecords).all()).toHaveLength(
      auditBefore,
    );
    expect(
      (await caller.schedules.update({ id: saved.id, enabled: false })).enabled,
    ).toBe(false);
    expect(
      (await caller.schedules.update({ id: saved.id, enabled: true })).enabled,
    ).toBe(true);
    await Promise.resolve(
      expect(f.foreignCaller.schedules.get({ id: saved.id })).rejects.toThrow(
        "Not found",
      ),
    );
    await caller.schedules.delete({ id: saved.id });
    expect(
      f.store.db
        .select()
        .from(schedules)
        .where(eq(schedules.id, saved.id))
        .get(),
    ).toBeUndefined();
    const auditKinds = (
      await caller.audit.list({ object_id: saved.id })
    ).results.map((record) => record.kind);
    expect(auditKinds).toContain("schedule.created");
    expect(auditKinds).toContain("schedule.updated");
    expect(auditKinds).toContain("schedule.deleted");
  } finally {
    f.close();
  }
});

test("webhook secrets are returned once, rotate immediately, and pin saved versions", async () => {
  const f = await automationFixture();
  try {
    const caller = f.caller();
    const created = await caller.webhooks.create({
      name: "Incoming",
      action: f.saved.action,
    });
    const persisted = f.store.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, created.webhook.id))
      .get()!;
    expect(persisted.secretHash).toBe(digest(created.secret));
    expect(persisted.secretHash).not.toBe(created.secret);
    const listed = await caller.webhooks.list();
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect(listed.results[0]).not.toHaveProperty("secretHash");
    expect(
      await caller.webhooks.get({ id: created.webhook.id }),
    ).not.toHaveProperty("secret");
    const latest = f.store.db
      .select()
      .from(actionVersions)
      .where(eq(actionVersions.id, f.saved.version.id))
      .get()!;
    f.store.db
      .insert(actionVersions)
      .values({
        ...latest,
        id: crypto.randomUUID(),
        number: 2,
        source: "return 2;",
      })
      .run();
    expect(
      (await caller.webhooks.get({ id: created.webhook.id })).version,
    ).toBe(1);
    const rotated = await caller.webhooks.rotate({ id: created.webhook.id });
    expect(rotated.secret).not.toBe(created.secret);
    const deliver = (secret: string) =>
      f.request(
        created.webhook.endpoint,
        "POST",
        { inputs: { value: 1 } },
        undefined,
        {
          "x-webhook-secret": secret,
          "x-webhook-delivery": crypto.randomUUID(),
        },
      );
    expect((await deliver(created.secret)).status).toBe(403);
    expect((await deliver(rotated.secret)).status).toBe(202);
    await caller.webhooks.update({ id: created.webhook.id, enabled: false });
    expect((await deliver(rotated.secret)).status).toBe(403);
    await Promise.resolve(
      expect(
        f.foreignCaller.webhooks.rotate({ id: created.webhook.id }),
      ).rejects.toThrow("Not found"),
    );
    await Promise.resolve(
      expect(
        caller.webhooks.create({
          name: "Foreign",
          action: f.foreignSaved.action,
        }),
      ).rejects.toThrow("Not found"),
    );
  } finally {
    f.close();
  }
});
