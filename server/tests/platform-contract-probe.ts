import assert from "node:assert/strict";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../app";
import { openStore } from "../db";
import { openDatabase } from "../db/connection";
import { databaseFilename } from "../db/migrate";
import { inTransaction } from "../db/transaction";
import * as schema from "../db/schema";
import { backupDatabase, restoreDatabase } from "../cli/database";
import { password } from "../platform/password";
import { serve } from "../platform/server";
import { verifyApplicationHttpContract } from "./platform-http-contract";

const directory = process.argv[2];
const existingHash = process.argv[3];
if (!directory || !existingHash) {
  throw new Error("Expected isolated data directory and password fixture");
}
const runtime = typeof Bun === "undefined" ? "node" : "bun";
assert.equal(
  runtime,
  process.argv[4],
  "Contract must execute in the selected runtime",
);
assert.equal(await password.verify("existing password", existingHash), true);
assert.equal(await password.verify("wrong password", existingHash), false);
const freshHash = await password.hash("new password");
assert.ok(freshHash.startsWith("$argon2id$v=19$m=65536,t=2,p=1$"));
assert.equal(await password.verify("new password", freshHash), true);
const fresh = openStore(join(directory, "fresh"));
fresh.close();
const source = join(directory, "source");
const store = openStore(source);
try {
  const response = await createApp(store)(
    new Request("http://localhost/trpc/system.health"),
  );
  assert.equal(response.status, 200);
  assert.equal(
    store.db.select().from(schema.users).get()?.passwordHash,
    existingHash,
  );
  assert.throws(
    () =>
      inTransaction(store, (context) => {
        context.db
          .insert(schema.users)
          .values({
            username: "rollback",
            email: "rollback@example.test",
            passwordHash: freshHash,
          })
          .run();
        throw new Error("rollback marker");
      }),
    /rollback marker/,
  );
  assert.equal(store.db.select().from(schema.users).all().length, 1);
  const contender = openDatabase(join(source, databaseFilename));
  try {
    contender.sqlite.exec("PRAGMA busy_timeout=0");
    inTransaction(store, () => {
      assert.throws(
        () => contender.sqlite.exec("BEGIN IMMEDIATE"),
        /locked|busy/i,
      );
    });
  } finally {
    contender.sqlite.close();
  }
  inTransaction(store, (context) => {
    context.db
      .insert(schema.users)
      .values({
        username: "outer",
        email: "outer@example.test",
        passwordHash: freshHash,
      })
      .run();
    assert.throws(
      () =>
        inTransaction(context, (nested) => {
          nested.db
            .insert(schema.users)
            .values({
              username: "nested",
              email: "nested@example.test",
              passwordHash: freshHash,
            })
            .run();
          throw new Error("savepoint marker");
        }),
      /savepoint marker/,
    );
  });
  assert.deepEqual(
    store.db
      .select({ username: schema.users.username })
      .from(schema.users)
      .all(),
    [{ username: "existing" }, { username: "outer" }],
  );
  const backup = join(directory, "backup.sqlite3");
  backupDatabase(source, backup);
  const restoredDirectory = join(directory, "restored");
  mkdirSync(restoredDirectory);
  copyFileSync(
    join(source, "encryption.key"),
    join(restoredDirectory, "encryption.key"),
  );
  restoreDatabase(restoredDirectory, backup);
  const restored = openStore(restoredDirectory);
  try {
    assert.equal(
      restored.db.select().from(schema.users).get()?.passwordHash,
      existingHash,
    );
  } finally {
    restored.close();
  }
} finally {
  store.close();
}

const httpStore = openStore(join(directory, "http"));
const application = createApp(httpStore);
const server = await serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    if (new URL(request.url).pathname === "/echo") {
      const headers = new Headers();
      headers.append("Set-Cookie", "first=one; HttpOnly");
      headers.append("Set-Cookie", "second=two; HttpOnly");
      return new Response(await request.text(), { headers });
    }
    if (new URL(request.url).pathname === "/stream") {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("first event\n"));
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode("second event\n"));
              controller.close();
            }, 20);
          },
        }),
      );
    }
    return application(request);
  },
});
try {
  const origin = `http://127.0.0.1:${server.port}`;
  await verifyApplicationHttpContract(origin);
  const response = await fetch(`${origin}/echo`, {
    method: "POST",
    body: "hello",
  });
  assert.equal(await response.text(), "hello");
  assert.equal(response.headers.getSetCookie().length, 2);
  const stream = await fetch(`${origin}/stream`);
  assert.equal(await stream.text(), "first event\nsecond event\n");
  const oversized = await fetch(`${origin}/echo`, {
    method: "POST",
    body: "x".repeat(2_000_001),
  });
  assert.equal(oversized.status, 413);
  assert.equal(
    await (await fetch(origin)).text(),
    "<h1>portable static asset</h1>",
  );
  const head = await fetch(origin, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
} finally {
  await server.stop(true);
  httpStore.close();
}
console.log(
  JSON.stringify({
    hash: freshHash,
    status: "ok",
    runtime,
    version: runtime === "bun" ? process.versions.bun : process.versions.node,
  }),
);
