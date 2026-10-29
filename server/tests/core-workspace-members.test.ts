import { expect, test } from "bun:test";
import { memberships, users } from "../db/schema/core";
import {
  client,
  loginOwner,
  sessionCookie,
  setup,
  store,
} from "./core-fixture";

test("native membership mutations enforce owner, admin, and self-removal rules", async () => {
  const s = store();
  await client(s).auth.setup(setup);
  const owner = await loginOwner(s);
  const signup = client(s);
  await signup.auth.signup({
    email: "member@example.com",
    username: "member",
    password: "member strong password",
  });
  const member = s.db
    .select()
    .from(users)
    .all()
    .find((user) => user.email === "member@example.com")!;
  const membership = s.db
    .insert(memberships)
    .values({ workspaceId: 1, userId: member.id, role: "member" })
    .returning()
    .get();
  const memberCookie = `${sessionCookie(signup.ctx)}; csrftoken=test`;
  expect(await client(s, owner.cookie).workspace.list()).toEqual([
    { id: 1, name: "Test", role: "owner", is_active: true },
  ]);
  expect(
    await client(s, owner.cookie).workspace.update({ name: "Renamed" }),
  ).toEqual({ id: 1, name: "Renamed" });
  expect(
    (await client(s, memberCookie).workspace.current()).invitations,
  ).toEqual([]);
  await Promise.resolve(
    expect(
      client(s, memberCookie).workspace.update({ name: "Forbidden" }),
    ).rejects.toThrow("Only workspace owners and admins"),
  );
  await Promise.resolve(
    expect(
      client(s, memberCookie).workspace.updateMember({
        id: membership.id,
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" }),
  );
  await Promise.resolve(
    expect(
      client(s, owner.cookie).workspace.removeMember({ id: 1 }),
    ).rejects.toThrow("Transfer ownership"),
  );
  expect(
    (
      await client(s, owner.cookie).workspace.updateMember({
        id: membership.id,
        role: "admin",
      })
    ).role,
  ).toBe("admin");
  await Promise.resolve(
    expect(
      client(s, memberCookie).workspace.transferOwnership({ membership_id: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" }),
  );
  expect(
    await client(s, owner.cookie).workspace.transferOwnership({
      membership_id: membership.id,
    }),
  ).toEqual({ transferred: true });
  expect((await client(s, memberCookie).workspace.current()).role).toBe(
    "owner",
  );
  expect(
    await client(s, owner.cookie).workspace.removeMember({ id: 1 }),
  ).toEqual({ removed: true });
  await Promise.resolve(
    expect(client(s, owner.cookie).workspace.current()).rejects.toThrow(
      "not a member",
    ),
  );
  s.close();
});
