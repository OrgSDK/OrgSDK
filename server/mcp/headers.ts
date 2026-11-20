import type { ServiceContext } from "../application";
import { credentials } from "../db/schema";
import { base } from "../shared/records";
import { encrypt } from "../shared/security";
import { requireWorkspace } from "../shared/authorization";
import { ServiceError } from "../shared/errors";

export function createHeaderCredential(
  ctx: ServiceContext,
  name: string,
  headers: Record<string, string> | undefined,
) {
  if (!headers || !Object.keys(headers).length) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Enter a bearer token or authentication headers.",
    );
  }
  return ctx.db
    .insert(credentials)
    .values({
      ...base(requireWorkspace(ctx).id),
      name,
      provider: "mcp-headers",
      encryptedSecret: encrypt(ctx, JSON.stringify({ headers })),
    })
    .returning()
    .get().id;
}
