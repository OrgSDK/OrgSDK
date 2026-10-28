import { z } from "zod";
import { requireIdentity } from "./context";
import { requireFresh } from "./sessions";
import { ServiceError } from "../shared/errors";
import { inTransaction } from "../db/transaction";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { users } from "../db/schema/core";
import { type ServiceContext } from "../application";
import { identityRepository } from "../repositories/identity";
import { decrypt, digest } from "../shared/security";
export const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += base32Alphabet[(value >>> (bits -= 5)) & 31];
    }
  }
  if (bits) {
    out += base32Alphabet[(value << (5 - bits)) & 31];
  }
  return out;
}

export function decode32(secret: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | base32Alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits -= 8)) & 255);
    }
  }
  return Buffer.from(bytes);
}

export function totpCounter(secret: string, code: string): number | null {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  for (let offset = -1; offset <= 1; offset++) {
    const step = Math.floor(Date.now() / 30000) + offset;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hash = createHmac("sha1", decode32(secret)).update(counter).digest();
    const index = hash[19]! & 15;
    const result = String(
      (hash.readUInt32BE(index) & 0x7fffffff) % 1000000,
    ).padStart(6, "0");
    if (timingSafeEqual(Buffer.from(code), Buffer.from(result))) {
      return step;
    }
  }
  return null;
}

export function consumeCode(
  ctx: ServiceContext,
  user: typeof users.$inferSelect,
  code: string,
): boolean {
  return inTransaction(ctx, (ctx) => {
    const current = identityRepository(ctx.db).user(user.id);
    if (!current?.totpSecret) {
      return false;
    }
    const step = totpCounter(decrypt(ctx, current.totpSecret), code);
    if (
      step !== null &&
      (current.totpLastCounter === null || step > current.totpLastCounter)
    ) {
      ctx.db
        .update(users)
        .set({ totpLastCounter: step })
        .where(eq(users.id, current.id))
        .run();
      return true;
    }
    const hashes = z.array(z.string()).parse(JSON.parse(current.recoveryCodes));
    const index = hashes.indexOf(digest(code));
    if (index < 0) {
      return false;
    }
    hashes.splice(index, 1);
    ctx.db
      .update(users)
      .set({ recoveryCodes: JSON.stringify(hashes) })
      .where(eq(users.id, current.id))
      .run();
    return true;
  });
}

export function requireEnabledTotp(ctx: ServiceContext) {
  const user = requireIdentity(ctx);
  requireFresh(ctx);
  if (!user.totpSecret) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Enable two-factor authentication first.",
    );
  }
  return user;
}
