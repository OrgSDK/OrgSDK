import { eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { decrypt } from "../shared/security";
export function redact(
  ctx: AppContext,
  workspaceId: number,
  value: unknown,
): any {
  const secrets: string[] = [];
  const collect = (entry: unknown) => {
    if (typeof entry === "string" && entry) secrets.push(entry);
    else if (Array.isArray(entry)) entry.forEach(collect);
    else if (entry && typeof entry === "object")
      Object.values(entry).forEach(collect);
  };
  for (const credential of ctx.store.db
    .select()
    .from(t.credentials)
    .where(eq(t.credentials.workspaceId, workspaceId))
    .all()) {
    collect(JSON.parse(decrypt(ctx.store, credential.encryptedSecret)));
  }
  secrets.sort((a, b) => b.length - a.length);
  const mask = (entry: unknown): any => {
    if (typeof entry === "string")
      return secrets.reduce(
        (text, secret) => text.replaceAll(secret, "[REDACTED]"),
        entry,
      );
    if (Array.isArray(entry)) return entry.map(mask);
    if (entry && typeof entry === "object")
      return Object.fromEntries(
        Object.entries(entry).map(([key, child]) => [mask(key), mask(child)]),
      );
    return entry;
  };
  return mask(value);
}

export function bounded(value: unknown, limit = 200000) {
  if (Buffer.byteLength(JSON.stringify(value)) > limit)
    throw new HttpError(400, "Data exceeds the response limit.");
  return value;
}
