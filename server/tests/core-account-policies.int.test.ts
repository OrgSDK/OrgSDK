import { expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { IdentityContext } from "../auth/context";
import { rotateSession } from "../auth/sessions";
import { sessions, users } from "../db/schema/core";
import {
  client,
  loginOwner,
  sessionCookie,
  setup,
  store,
} from "./core-fixture";

test("signed-in users can manage their account before joining a workspace", async () => {
  const database = store();
  try {
    await client(database).auth.setup(setup);
    const signup = client(database);
    await signup.auth.signup({
      email: "invited@example.com",
      username: "invited",
      password: "invited strong password",
    });
    const cookie = `${sessionCookie(signup.ctx)}; csrftoken=test`;
    const account = client(database, cookie);
    expect(account.ctx.role).toBeNull();
    expect(await account.users.me()).toMatchObject({
      email: "invited@example.com",
    });
    expect(
      await account.users.updateMe({ first_name: "Invited" }),
    ).toMatchObject({
      first_name: "Invited",
    });
    expect(
      await account.auth.changeEmail({ email: "updated@example.com" }),
    ).toEqual([
      { email: "updated@example.com", primary: true, verified: false },
    ]);
    await Promise.resolve(
      expect(
        client(database, cookie).workspace.current(),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      }),
    );
    const external = client(database, cookie, "localhost", {
      authorization: "Basic external-client",
    });
    await Promise.resolve(
      expect(external.users.me()).rejects.toThrow("requires a browser session"),
    );
    await Promise.resolve(
      expect(
        external.auth.changeEmail({ email: "blocked@example.com" }),
      ).rejects.toThrow("requires a browser session"),
    );
    expect((await client(database, cookie).users.me()).email).toBe(
      "updated@example.com",
    );
  } finally {
    database.close();
  }
});

test("password changes revoke other sessions and issue a usable replacement", async () => {
  const database = store();
  try {
    await client(database).auth.setup(setup);
    const original = await loginOwner(database);
    const other = await loginOwner(database);
    const account = client(database, original.cookie);
    expect(
      (
        await account.auth.changePassword({
          current_password: setup.password1,
          new_password: "replacement strong password",
        })
      ).is_authenticated,
    ).toBe(true);
    expect(
      (await client(database, other.cookie).auth.session()).is_authenticated,
    ).toBe(false);
    expect(
      (await client(database, original.cookie).auth.session()).is_authenticated,
    ).toBe(false);
    const replacement = `${sessionCookie(account.ctx)}; csrftoken=test`;
    expect(
      (await client(database, replacement).auth.session()).is_authenticated,
    ).toBe(true);
    expect(database.db.select().from(sessions).all()).toHaveLength(1);
    const owner = database.db.select().from(users).where(eq(users.id, 1)).get();
    if (!owner) {
      throw new Error("Expected the workspace owner.");
    }
    expect(
      await Bun.password.verify(
        "replacement strong password",
        owner.passwordHash,
      ),
    ).toBe(true);
  } finally {
    database.close();
  }
});

test("session rotation rolls back account and session writes when its mutation fails", async () => {
  const database = store();
  try {
    await client(database).auth.setup(setup);
    const owner = await loginOwner(database);
    const sessionChanged = mock(() => {});
    const context: IdentityContext = {
      ...client(database, owner.cookie).ctx,
      sessionChanged,
    };
    const user = context.user;
    const originalSessionId = context.sessionId;
    if (!user || !originalSessionId) {
      throw new Error("Expected an authenticated owner session.");
    }
    const originalSessions = database.db.select().from(sessions).all();
    const callbackOrder: string[] = [];
    let guardContext: IdentityContext | undefined;
    const failure = new Error("Injected session rotation failure.");
    expect(() =>
      rotateSession(
        context,
        user.id,
        null,
        (transaction) => {
          callbackOrder.push("guard");
          guardContext = transaction;
          expect(transaction.db).not.toBe(context.db);
        },
        (transaction) => {
          callbackOrder.push("mutation");
          expect(guardContext).toBe(transaction);
          expect(transaction.db).not.toBe(context.db);
          transaction.db
            .update(users)
            .set({ firstName: "Uncommitted" })
            .where(eq(users.id, user.id))
            .run();
          transaction.db
            .delete(sessions)
            .where(eq(sessions.id, originalSessionId))
            .run();
          transaction.db
            .insert(sessions)
            .values({
              id: "uncommitted-replacement",
              userId: user.id,
              workspaceId: context.workspace?.id ?? null,
              expiresAt: Date.now() + 60000,
            })
            .run();
          throw failure;
        },
      ),
    ).toThrow(failure);
    expect(callbackOrder).toEqual(["guard", "mutation"]);
    expect(
      database.db.select().from(users).where(eq(users.id, user.id)).get(),
    ).toEqual(user);
    expect(database.db.select().from(sessions).all()).toEqual(originalSessions);
    expect(context.sessionId).toBe(originalSessionId);
    expect(sessionChanged).not.toHaveBeenCalled();
    expect(
      (await client(database, owner.cookie).auth.session()).is_authenticated,
    ).toBe(true);
  } finally {
    database.close();
  }
});
