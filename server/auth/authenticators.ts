import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { users } from "../db/schema/core";
import { type AppContext, requireUser } from "../http/context";
import { input, json } from "../http/responses";
import { identityRepository } from "../repositories/identity";
import { decrypt, digest, encrypt } from "../shared/security";
import { assertCurrentUser, requireFresh } from "./sessions";
import { throttle } from "./throttle";
import { base32, totpCounter } from "./totp";
import { authError } from "./views";
export async function handleAuthenticators(
  ctx: AppContext,
  path: string,
  method: string,
): Promise<Response | null> {
  const db = ctx.store.db;
  if (path === "/account/authenticators" && method === "GET") {
    const user = requireUser(ctx);
    return json({
      status: 200,
      data: user.totpSecret ? [{ type: "totp" }] : [],
    });
  }
  if (path === "/account/authenticators/totp") {
    const user = requireUser(ctx);
    requireFresh(ctx);
    if (method === "GET") {
      if (user.totpSecret) return json({ status: 200, data: { type: "totp" } });
      const secret = base32(randomBytes(20));
      db.update(users)
        .set({ pendingTotpSecret: encrypt(ctx.store, secret) })
        .where(eq(users.id, user.id))
        .run();
      return json({ status: 404, meta: { secret } }, 404);
    }
    if (method === "POST") {
      const body = await input(ctx.request);
      throttle(ctx, `totp-setup:${user.id}`);
      return ctx.store.sqlite
        .transaction(() => {
          assertCurrentUser(ctx, user);
          requireFresh(ctx);
          const current = identityRepository(ctx.store).user(user.id);
          const step = current?.pendingTotpSecret
            ? totpCounter(
                decrypt(ctx.store, current.pendingTotpSecret),
                String(body.code ?? ""),
              )
            : null;
          if (!current?.pendingTotpSecret || step === null)
            return authError("Invalid authentication code.");
          db.update(users)
            .set({
              totpSecret: current.pendingTotpSecret,
              pendingTotpSecret: null,
              totpLastCounter: step,
            })
            .where(eq(users.id, user.id))
            .run();
          return json({ status: 200, data: { type: "totp" } });
        })
        .immediate();
    }
    if (method === "DELETE") {
      db.update(users)
        .set({
          totpSecret: null,
          pendingTotpSecret: null,
          totpLastCounter: null,
          recoveryCodes: "[]",
        })
        .where(eq(users.id, user.id))
        .run();
      return json({ status: 200, data: {} });
    }
  }
  if (path === "/account/authenticators/recovery-codes") {
    const user = requireUser(ctx);
    requireFresh(ctx);
    if (!user.totpSecret)
      return authError("Enable two-factor authentication first.");
    if (method === "GET")
      return json({ status: 200, data: { unused_codes: [] } });
    if (method === "POST") {
      const codes = Array.from({ length: 10 }, () =>
        randomBytes(8).toString("hex"),
      );
      db.update(users)
        .set({ recoveryCodes: JSON.stringify(codes.map(digest)) })
        .where(eq(users.id, user.id))
        .run();
      return json({ status: 200, data: { unused_codes: codes } });
    }
  }
  return null;
}
