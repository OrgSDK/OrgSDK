import { eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError, json } from "../http/responses";
import { now } from "../shared/records";
import { type Executor } from "./authority";
import { configuration } from "./configuration";
export function register(
  ctx: AppContext,
  worker: Executor,
  body: Record<string, unknown>,
): Response {
  const version = body.protocol_version;
  const capabilities = body.capabilities;
  if (
    typeof version !== "number" ||
    ![1, 2, 3].includes(version) ||
    !Array.isArray(capabilities) ||
    capabilities.some(
      (cap: unknown) =>
        !["action", "code", "validate", "test"].includes(String(cap)),
    ) ||
    (version < 2 && capabilities.includes("code")) ||
    (version < 3 &&
      capabilities.some((cap: string) => ["validate", "test"].includes(cap)))
  ) {
    throw new HttpError(400, "Unsupported executor protocol or capability.");
  }
  const validatedCapabilities = capabilities.filter(
    (capability: unknown): capability is string =>
      typeof capability === "string",
  );
  const registered = ctx.db
    .update(t.executors)
    .set({
      protocolVersion: version,
      capabilities: validatedCapabilities,
      lastSeenAt: now(),
      updatedAt: now(),
    })
    .where(eq(t.executors.id, worker.id))
    .returning()
    .get()!;
  return json(configuration(ctx, registered));
}
