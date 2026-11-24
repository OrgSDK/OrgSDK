import type { z } from "zod";
import type { ServiceContext } from "../application";
import { credentials } from "../db/schema";
import { recordAudit } from "../repositories/audit";
import { requireWorkspace } from "../shared/authorization";
import { ServiceError } from "../shared/errors";
import { base } from "../shared/records";
import { credentialPublicFields } from "./queries";
import type { credentialCreateSchema } from "./schemas";

export function insertCredential(
  context: ServiceContext,
  input: z.output<typeof credentialCreateSchema>,
) {
  if (input.provider.startsWith("mcp-")) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Manage MCP credentials from project plugins.",
    );
  }
  const credential = context.db
    .insert(credentials)
    .values({
      ...base(requireWorkspace(context).id),
      name: input.name,
      provider: input.provider,
      encryptedSecret: context.secrets.encrypt(JSON.stringify(input.secret)),
    })
    .returning(credentialPublicFields)
    .get();
  recordAudit(context, "credential", credential.id, "created");
  return credential;
}
