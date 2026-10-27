import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { eq, or } from "drizzle-orm";
import type { Store } from "./db";
import { users, sessions } from "./db/core";

export async function resetPassword(store: Store, email: string) {
  if (!process.stdin.isTTY)
    throw new Error(
      "Run reset-password in an interactive terminal. Passwords are never accepted as command arguments.",
    );
  const user = store.db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .get();
  if (!user) throw new Error("Account not found.");
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    process.stdout.write("New password: ");
    const password = await terminal.question("");
    process.stdout.write("\nConfirm password: ");
    const confirmation = await terminal.question("");
    process.stdout.write("\n");
    if (password !== confirmation) throw new Error("Passwords do not match.");
    if (password.length < 8 || password.length > 1024 || /^\d+$/.test(password))
      throw new Error(
        "Use a password of 8–1024 characters that is not entirely numeric.",
      );
    const passwordHash = await Bun.password.hash(password);
    store.sqlite
      .transaction(() => {
        store.db
          .update(users)
          .set({ passwordHash })
          .where(eq(users.id, user.id))
          .run();
        store.db
          .delete(sessions)
          .where(
            or(
              eq(sessions.userId, user.id),
              eq(sessions.pendingUserId, user.id),
            ),
          )
          .run();
      })
      .immediate();
    console.log("Password changed. Existing sign-in sessions were revoked.");
  } finally {
    terminal.close();
  }
}
