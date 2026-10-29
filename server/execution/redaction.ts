import { z } from "zod";
import type { JsonValue } from "../db/types";
import { eq } from "drizzle-orm";
import * as t from "../db/schema";
import { type ServiceContext } from "../application";
import { HttpError } from "../http/responses";
import { decrypt } from "../shared/security";
export function redact(
  ctx: ServiceContext,
  workspaceId: number,
  value: string,
): string;
export function redact(
  ctx: ServiceContext,
  workspaceId: number,
  value: unknown,
): JsonValue;
export function redact(
  ctx: ServiceContext,
  workspaceId: number,
  value: unknown,
): JsonValue {
  const secrets: string[] = [];
  const collect = (entry: unknown) => {
    if (typeof entry === "string" && entry) {
      secrets.push(entry);
    } else if (Array.isArray(entry)) {
      entry.forEach(collect);
    } else if (entry && typeof entry === "object") {
      Object.values(entry).forEach(collect);
    }
  };
  for (const credential of ctx.db
    .select()
    .from(t.credentials)
    .where(eq(t.credentials.workspaceId, workspaceId))
    .all()) {
    collect(JSON.parse(decrypt(ctx, credential.encryptedSecret)));
  }
  secrets.sort((a, b) => b.length - a.length);
  const mask = (entry: JsonValue): JsonValue => {
    if (typeof entry === "string") {
      return secrets.reduce(
        (text, secret) => text.replaceAll(secret, "[REDACTED]"),
        entry,
      );
    }
    if (Array.isArray(entry)) {
      return entry.map(mask);
    }
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry).map(([key, child]) => [
          typeof key === "string"
            ? secrets.reduce(
                (text, secret) => text.replaceAll(secret, "[REDACTED]"),
                key,
              )
            : key,
          mask(child),
        ]),
      );
    }
    return entry;
  };
  return mask(z.json().parse(value));
}

export function bounded(value: unknown, limit = 200000) {
  if (Buffer.byteLength(JSON.stringify(value)) > limit) {
    throw new HttpError(400, "Data exceeds the response limit.");
  }
  return value;
}
