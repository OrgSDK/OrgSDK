import assert from "node:assert/strict";
import { test } from "bun:test";
import { eq } from "drizzle-orm";
import { TRPCClientError } from "@trpc/client";
import { memberships } from "../../server/db/schema/core.ts";
import { trpcFixture } from "./trpc-fixture.mjs";

function hasCode(code) {
  return (error) =>
    error instanceof TRPCClientError && error.data?.code === code;
}

test("native client bootstraps CSRF, reads rotation after login and accepts bodyless mutations", async () => {
  const fixture = trpcFixture();
  try {
    const { client, cookies, requests } = fixture;
    const status = await client.auth.setupStatus.query();
    assert.equal(status.setup_required, true);
    const bootstrapToken = cookies.get("csrftoken");
    assert.equal(typeof bootstrapToken, "string");
    assert.equal(requests[0].csrf, null);
    const setup = {
      domain: "localhost",
      workspace_name: "Client test",
      username: "client-owner",
      email: "owner@example.test",
      password1: "Native-Client-Test_Password42!",
      password2: "Native-Client-Test_Password42!",
    };
    await assert.rejects(
      fixture.clientWithCsrf(() => undefined).auth.setup.mutate(setup),
      hasCode("FORBIDDEN"),
    );
    assert.equal((await client.auth.setup.mutate(setup)).setup_required, false);
    const authenticated = await client.auth.login.mutate({
      email: setup.email,
      password: setup.password1,
    });
    assert.equal(authenticated.is_authenticated, true);
    const rotatedToken = cookies.get("csrftoken");
    assert.notEqual(rotatedToken, bootstrapToken);
    const created = await client.projects.create.mutate({
      name: "Disposable project",
    });
    assert.equal(created.name, "Disposable project");
    assert.equal(requests.at(-1).csrf, rotatedToken);
    assert.equal(requests.at(-1).credentials, "same-origin");
    const deleted = await client.projects.delete.mutate({ id: created.id });
    assert.equal(deleted, undefined);
    await assert.rejects(
      client.projects.get.query({ id: created.id }),
      hasCode("NOT_FOUND"),
    );
    assert.equal((await client.auth.logout.mutate()).is_authenticated, false);
    await assert.rejects(
      client.workspace.current.query(),
      hasCode("UNAUTHORIZED"),
    );
  } finally {
    await fixture.close();
  }
});

test("native client retains server error codes for setup, schema validation and membership authority", async () => {
  const fixture = trpcFixture();
  try {
    await assert.rejects(
      fixture.client.auth.session.query(),
      hasCode("PRECONDITION_FAILED"),
    );
    const seeded = fixture.seedSession();
    await fixture.client.auth.session.query();
    await assert.rejects(
      fixture.client.projects.get.query({ id: "invalid-identifier" }),
      hasCode("BAD_REQUEST"),
    );
    fixture.store.db
      .update(memberships)
      .set({ role: "member" })
      .where(eq(memberships.userId, seeded.user.id))
      .run();
    await assert.rejects(
      fixture.client.projects.create.mutate({ name: "Unauthorized project" }),
      hasCode("FORBIDDEN"),
    );
    const projects = await fixture.client.projects.list.query();
    assert.deepEqual(
      projects.results.map((project) => project.id),
      [seeded.project.id],
    );
  } finally {
    await fixture.close();
  }
});

test("native query batches isolate cancellation and keep mutations in separate requests", async () => {
  const fixture = trpcFixture();
  let release = () => {};
  try {
    const seeded = fixture.seedSession();
    await fixture.client.auth.session.query();
    fixture.requests.length = 0;
    const held = fixture.pauseNext();
    release = held.release;
    const controller = new globalThis.AbortController();
    const cancelled = fixture.client.projects.list.query(undefined, {
      signal: controller.signal,
    });
    const surviving = fixture.client.workspace.current.query();
    await held.started;
    controller.abort();
    held.release();
    const retiredResult = await cancelled;
    assert.equal(controller.signal.aborted, true);
    assert.equal(retiredResult.results[0].id, seeded.project.id);
    assert.equal((await surviving).workspace.id, seeded.workspace.id);
    assert.equal(fixture.requests.length, 1);
    assert.match(fixture.requests[0].path, /projects\.list,workspace\.current/);
    assert.equal(fixture.requests[0].method, "GET");
    const single = fixture.pauseNext();
    release = single.release;
    const singleController = new globalThis.AbortController();
    const pending = fixture.client.projects.list.query(undefined, {
      signal: singleController.signal,
    });
    const rejected = assert.rejects(
      pending,
      (error) =>
        error.name === "AbortError" || error.cause?.name === "AbortError",
    );
    await single.started;
    singleController.abort();
    single.release();
    await rejected;
    fixture.requests.length = 0;
    const [document, inventory] = await Promise.all([
      fixture.client.documents.create.mutate({
        kind: "document",
        title: "Typed body",
        content: "Native transport",
      }),
      fixture.client.projects.list.query(),
    ]);
    assert.equal(document.content, "Native transport");
    assert.equal(inventory.results[0].id, seeded.project.id);
    assert.deepEqual(
      fixture.requests.map((request) => request.method).toSorted(),
      ["GET", "POST"],
    );
  } finally {
    release();
    await fixture.close();
  }
});
